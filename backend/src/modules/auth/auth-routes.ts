import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/redis-connection.js';

const STATE_TTL_SECONDS = 600;
const SESSION_COOKIE = 'reachinbox_session';
const redis = createRedisConnection();

export interface AuthIdentity {
  userId: string;
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request { auth?: AuthIdentity }
  }
}

interface GoogleTokenResponse { access_token?: string; error?: string }
interface GoogleProfile {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export const authRouter = Router();

authRouter.get('/google', async (_request, response) => {
  try {
    const oauth = googleConfiguration();
    const state = randomBytes(32).toString('base64url');
    const saved = await redis.set(stateKey(state), '1', 'EX', STATE_TTL_SECONDS, 'NX');
    if (saved !== 'OK') throw new Error('OAuth state could not be saved.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', oauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    response.redirect(url.toString());
  } catch {
    response.status(503).json({ error: 'Google sign-in is not configured. Check server configuration.' });
  }
});

authRouter.get('/google/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(state)) {
    response.status(400).json({ error: 'Google OAuth state is missing or invalid.' });
    return;
  }

  try {
    if (!await redis.getdel(stateKey(state))) {
      response.status(400).json({ error: 'Google OAuth state expired or was already used. Start again.' });
      return;
    }

    if (typeof request.query.error === 'string') {
      response.status(400).json({ error: 'Google authorization was denied.' });
      return;
    }
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code) {
      response.status(400).json({ error: 'Google did not return an authorization code.' });
      return;
    }

    const oauth = googleConfiguration();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenData = await tokenResponse.json() as GoogleTokenResponse;

    if (!tokenResponse.ok || !tokenData.access_token) {
      response.status(401).json({ error: 'Google authorization code could not be exchanged.' });
      return;
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = await profileResponse.json() as GoogleProfile;

    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
      response.status(401).json({ error: 'Google did not provide a verified account profile.' });
      return;
    }

    const user = await findOrCreateGoogleUser(profile);

    await createSession(response, { userId: user.id, tenantId: user.tenantId });

    response.redirect(config.frontendUrl);
  } catch (error) {
    console.error('Google OAuth callback failed.', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    response.status(502).json({ error: 'Google sign-in could not be completed. Start again.' });
  }
});
authRouter.get('/me', async (request, response) => {
  try {
    const identity = await resolveSession(request);
    if (!identity) {
      response.status(401).json({ authenticated: false });
      return;
    }
    const user = await prisma.user.findFirst({
      where: { id: identity.userId, tenantId: identity.tenantId },
      select: { id: true, name: true, email: true, avatarUrl: true, tenant: { select: { id: true, name: true } } },
    });
    if (!user) {
      response.status(401).json({ authenticated: false });
      return;
    }
    response.json({ authenticated: true, user, tenant: user.tenant });
  } catch {
    response.status(503).json({ error: 'Authentication session is temporarily unavailable.' });
  }
});

authRouter.post('/logout', async (request, response) => {
  try {
    const sessionId = sessionIdFromRequest(request);
    if (sessionId) await redis.del(sessionKey(sessionId));
    clearSessionCookie(response);
    response.json({ ok: true });
  } catch {
    response.status(503).json({ error: 'Logout is temporarily unavailable.' });
  }
});

export async function attachOptionalAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    request.auth = await resolveSession(request) ?? undefined;
    next();
  } catch {
    response.status(503).json({ error: 'Authentication session is temporarily unavailable.' });
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!request.auth) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

function googleConfiguration(): { clientId: string; clientSecret: string; redirectUri: string } {
  const { googleClientId, googleClientSecret, googleRedirectUri, sessionSecret } = config;
  if (!googleClientId || !googleClientSecret || !googleRedirectUri || !sessionSecret || sessionSecret.length < 32) {
    throw new Error('Google OAuth requires client credentials, redirect URI, and SESSION_SECRET of at least 32 characters.');
  }
  const callback = new URL(googleRedirectUri);
  if (!['http:', 'https:'].includes(callback.protocol)) throw new Error('GOOGLE_REDIRECT_URI must be HTTP(S).');
  if (config.isProduction && callback.protocol !== 'https:') throw new Error('GOOGLE_REDIRECT_URI must use HTTPS in production.');
  return { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: callback.toString() };
}

async function findOrCreateGoogleUser(profile: GoogleProfile) {
  const subject = profile.sub!;
  const email = profile.email!.toLowerCase();
  const existingSubject = await prisma.user.findUnique({ where: { googleSubject: subject } });
  if (existingSubject) {
    return prisma.user.update({ where: { id: existingSubject.id }, data: { email, name: profile.name ?? null, avatarUrl: profile.picture ?? null } });
  }

  const existingEmail = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (existingEmail) {
    if (existingEmail.googleSubject && existingEmail.googleSubject !== subject) {
      throw new Error('Google account email is already linked to another Google identity.');
    }
    return prisma.user.update({ where: { id: existingEmail.id }, data: { googleSubject: subject, name: profile.name ?? null, avatarUrl: profile.picture ?? null } });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const preferred = config.searchTenantId
        ? await tx.tenant.findUnique({ where: { id: config.searchTenantId } })
        : null;
      const tenant = preferred ?? await tx.tenant.findFirst({ orderBy: { createdAt: 'asc' } })
        ?? await tx.tenant.create({ data: { name: 'ReachInbox Development' } });
      return tx.user.create({
        data: { tenantId: tenant.id, email, googleSubject: subject, name: profile.name ?? null, avatarUrl: profile.picture ?? null },
      });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const raced = await prisma.user.findUnique({ where: { googleSubject: subject } });
    if (raced) return raced;
    throw error;
  }
}

async function createSession(response: Response, identity: AuthIdentity): Promise<void> {
  const secret = config.sessionSecret;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const sessionId = randomBytes(32).toString('base64url');
  await redis.set(sessionKey(sessionId), JSON.stringify(identity), 'EX', config.sessionTtlSeconds);
  const signature = signSession(sessionId, secret);
  const secure = config.isProduction ? '; Secure' : '';
  response.setHeader('set-cookie', `${SESSION_COOKIE}=${sessionId}.${signature}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}${secure}`);
}

async function resolveSession(request: Request): Promise<AuthIdentity | null> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId || !config.sessionSecret || config.sessionSecret.length < 32) return null;
  const value = await redis.get(sessionKey(sessionId));
  if (!value) return null;
  const parsed = JSON.parse(value) as AuthIdentity;
  if (!parsed.userId || !parsed.tenantId) return null;
  return parsed;
}

function sessionIdFromRequest(request: Request): string | null {
  const cookie = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  const value = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!value) return null;
  const [sessionId, signature, ...rest] = value.split('.');
  const secret = config.sessionSecret;
  if (!sessionId || !signature || rest.length || !secret || !/^[A-Za-z0-9_-]{40,50}$/.test(sessionId)) return null;
  const expected = signSession(sessionId, secret);
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer) ? sessionId : null;
}

function signSession(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}
function stateKey(state: string): string { return `reachinbox:google:oauth-state:${state}`; }
function sessionKey(sessionId: string): string { return `reachinbox:session:${sessionId}`; }
function clearSessionCookie(response: Response): void {
  const secure = config.isProduction ? '; Secure' : '';
  response.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}
