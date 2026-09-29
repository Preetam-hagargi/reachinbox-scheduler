import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
loadDotEnv({ path: resolve(backendRoot, '.env') });

const redisUrl = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
const redisProtocol = new URL(redisUrl).protocol;

if (redisProtocol !== 'redis:' && redisProtocol !== 'rediss:') {
  throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
}

const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? '5');

if (!Number.isInteger(workerConcurrency) || workerConcurrency < 1) {
  throw new Error('WORKER_CONCURRENCY must be a positive integer.');
}

const minEmailDelayMs = Number(process.env.MIN_EMAIL_DELAY_MS ?? '2000');
if (!Number.isInteger(minEmailDelayMs) || minEmailDelayMs < 0) {
  throw new Error('MIN_EMAIL_DELAY_MS must be a non-negative integer.');
}

const maxEmailsPerHourPerSender = Number(
  process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? '200',
);
if (!Number.isInteger(maxEmailsPerHourPerSender) || maxEmailsPerHourPerSender < 1) {
  throw new Error('MAX_EMAILS_PER_HOUR_PER_SENDER must be a positive integer.');
}

const elasticsearchUrl = process.env.ELASTICSEARCH_URL?.trim() || 'http://localhost:9200';
const elasticsearchProtocol = new URL(elasticsearchUrl).protocol;
if (elasticsearchProtocol !== 'http:' && elasticsearchProtocol !== 'https:') {
  throw new Error('ELASTICSEARCH_URL must use the http:// or https:// protocol.');
}

const searchTenantId = process.env.SEARCH_TENANT_ID?.trim() || undefined;
if (searchTenantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(searchTenantId)) {
  throw new Error('SEARCH_TENANT_ID must be a valid UUID when set.');
}

const slackTokenEncryptionKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY?.trim() || undefined;
if (slackTokenEncryptionKey && !/^[0-9a-f]{64}$/i.test(slackTokenEncryptionKey)) {
  throw new Error('SLACK_TOKEN_ENCRYPTION_KEY must be a 32-byte hex value when set.');
}

const frontendUrl = process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
const frontendProtocol = new URL(frontendUrl).protocol;
if (frontendProtocol !== 'http:' && frontendProtocol !== 'https:') {
  throw new Error('FRONTEND_URL must use the http:// or https:// protocol.');
}
const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? '604800');
if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60) {
  throw new Error('SESSION_TTL_SECONDS must be an integer of at least 60 seconds.');
}

const bullBoardAdminEmail = process.env.BULL_BOARD_ADMIN_EMAIL?.trim().toLowerCase() || undefined;
if (bullBoardAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bullBoardAdminEmail)) {
  throw new Error('BULL_BOARD_ADMIN_EMAIL must be a valid email address when set.');
}

export const config = {
  redisUrl,
  workerConcurrency,
  minEmailDelayMs,
  maxEmailsPerHourPerSender,
  elasticsearchUrl,
  searchTenantId,
  slackClientId: process.env.SLACK_CLIENT_ID?.trim() || undefined,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET?.trim() || undefined,
  slackRedirectUri: process.env.SLACK_REDIRECT_URI?.trim() || undefined,
  slackTokenEncryptionKey,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || undefined,
  sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
  sessionTtlSeconds,
  bullBoardAdminEmail,
  frontendUrl: new URL(frontendUrl).origin,
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? '3000'),
};
