import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/redis-connection.js';
import { encryptSlackSecret } from '../../integrations/slack/secret-crypto.js';
import { requireSlackOAuthConfiguration } from '../../integrations/slack/slack-config.js';

const OAUTH_STATE_TTL_SECONDS = 600;
const oauthStateRedis = createRedisConnection();

interface SlackOAuthState {
  tenantId: string;
  userId: string;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team_id?: string;
  team_name?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: {
    url?: string;
    channel_id?: string;
    channel?: string;
  };
}

export const slackRouter = Router();

slackRouter.get('/status', async (request, response) => {
  const identity = request.auth;
  if (!identity) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }
  let oauthConfigured = true;
  try { requireSlackOAuthConfiguration(); } catch { oauthConfigured = false; }

  try {
    const connection = await prisma.slackConnection.findUnique({
      where: { tenantId_userId: identity },
      select: {
        teamId: true,
        teamName: true,
        webhookChannelId: true,
        webhookChannelName: true,
        webhookUrlCiphertext: true,
      },
    });
    response.json({
      connected: Boolean(connection),
      configured: oauthConfigured,
      workspace: connection ? { id: connection.teamId, name: connection.teamName } : null,
      channel: connection?.webhookUrlCiphertext
        ? { id: connection.webhookChannelId, name: connection.webhookChannelName }
        : null,
      connectUrl: '/slack/oauth/start',
    });
  } catch {
    response.status(503).json({ error: 'Slack connection status is temporarily unavailable.' });
  }
});

slackRouter.delete('/connection', async (request, response) => {
  const identity = request.auth;
  if (!identity) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    await prisma.slackConnection.deleteMany({
      where: { tenantId: identity.tenantId, userId: identity.userId },
    });
    response.json({ disconnected: true });
  } catch {
    response.status(503).json({ error: 'Slack could not be disconnected right now.' });
  }
});

slackRouter.get('/oauth/start', async (request, response) => {
  try {
    const oauth = requireSlackOAuthConfiguration();
    const identity = request.auth;
    if (!identity) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const user = await prisma.user.findFirst({
      where: { id: identity.userId, tenantId: identity.tenantId },
      select: { id: true },
    });
    if (!user) {
      response.status(401).json({ error: 'The signed-in user or tenant no longer exists.' });
      return;
    }

    const state = randomBytes(32).toString('base64url');
    const saved = await oauthStateRedis.set(
      stateKey(state),
      JSON.stringify(identity),
      'EX',
      OAUTH_STATE_TTL_SECONDS,
      'NX',
    );
    if (saved !== 'OK') throw new Error('Could not save OAuth state.');

    const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
    authorizeUrl.searchParams.set('client_id', oauth.clientId);
    authorizeUrl.searchParams.set('scope', 'incoming-webhook');
    authorizeUrl.searchParams.set('redirect_uri', oauth.callbackUrl);
    authorizeUrl.searchParams.set('state', state);
    response.redirect(authorizeUrl.toString());
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('Slack OAuth start failed.', { error: errorName });
    response.status(503).json({ error: 'Slack OAuth is not ready. Check the server configuration.' });
  }
});

slackRouter.get('/oauth/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  if (!state || !/^[A-Za-z0-9_-]{40,50}$/.test(state)) {
    response.status(400).json({ error: 'Slack OAuth state is missing or invalid.' });
    return;
  }

  try {
    const savedState = await oauthStateRedis.getdel(stateKey(state));
    if (!savedState) {
      response.status(400).json({ error: 'Slack OAuth state expired or was already used. Start again.' });
      return;
    }

    const identity = JSON.parse(savedState) as SlackOAuthState;

    if (typeof request.query.error === 'string') {
      response.redirect(`${config.frontendUrl}?slack=error`);
      return;
    }
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code) {
      response.redirect(`${config.frontendUrl}?slack=error`);
      return;
    }

    const oauth = requireSlackOAuthConfiguration();
    const user = await prisma.user.findFirst({
      where: { id: identity.userId, tenantId: identity.tenantId },
      select: { id: true },
    });
    if (!user) {
      response.status(400).json({ error: 'The OAuth user or tenant no longer exists.' });
      return;
    }

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.callbackUrl,
      }),
    });
    const tokenData = await tokenResponse.json() as SlackOAuthResponse;
    const webhookUrl = tokenData.incoming_webhook?.url;
    const teamId = tokenData.team?.id ?? tokenData.team_id;
    if (!tokenResponse.ok || !tokenData.ok || !tokenData.access_token || !teamId || !webhookUrl) {
      const detail = tokenData.error === 'missing_scope'
        ? 'Grant the incoming-webhook scope and select a channel in Slack.'
        : 'Slack authorization did not include a workspace token and incoming webhook.';
      response.redirect(`${config.frontendUrl}?slack=error`);
      return;
    }

    validateWebhookUrl(webhookUrl);
    await prisma.slackConnection.upsert({
      where: { tenantId_userId: identity },
      create: {
        ...identity,
        teamId,
        teamName: tokenData.team?.name ?? tokenData.team_name ?? null,
        accessTokenCiphertext: encryptSlackSecret(tokenData.access_token),
        webhookUrlCiphertext: encryptSlackSecret(webhookUrl),
        webhookChannelId: tokenData.incoming_webhook?.channel_id ?? null,
        webhookChannelName: tokenData.incoming_webhook?.channel ?? null,
      },
      update: {
        teamId,
        teamName: tokenData.team?.name ?? tokenData.team_name ?? null,
        accessTokenCiphertext: encryptSlackSecret(tokenData.access_token),
        webhookUrlCiphertext: encryptSlackSecret(webhookUrl),
        webhookChannelId: tokenData.incoming_webhook?.channel_id ?? null,
        webhookChannelName: tokenData.incoming_webhook?.channel ?? null,
      },
    });

    response.redirect(`${config.frontendUrl}?slack=connected`);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('Slack OAuth callback failed.', { error: errorName });
    response.redirect(`${config.frontendUrl}?slack=error`);
  }
});

function stateKey(state: string): string {
  return `reachinbox:slack:oauth-state:${state}`;
}


function validateWebhookUrl(value: string): void {
  const webhookUrl = new URL(value);
  if (
    webhookUrl.protocol !== 'https:'
    || webhookUrl.hostname !== 'hooks.slack.com'
    || webhookUrl.port
    || webhookUrl.username
    || webhookUrl.password
    || !webhookUrl.pathname.startsWith('/services/')
    || webhookUrl.search
    || webhookUrl.hash
  ) {
    throw new Error('Slack returned an invalid incoming webhook URL.');
  }
}
