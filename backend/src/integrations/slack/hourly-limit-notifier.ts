import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { prisma } from '../../db/prisma.js';
import { decryptSlackSecret } from './secret-crypto.js';

const NOTIFICATION_KEY_TTL_MS = 7_200_000;

export interface HourlyLimitNotification {
  senderId: string;
  tenantId: string;
  senderEmail: string;
  hourlyLimit: number;
  hourWindowStart: number;
  retryAt: number;
}

export class SlackHourlyLimitNotifier {
  constructor(private readonly redis: Redis) {}

  async notify(input: HourlyLimitNotification): Promise<void> {
    try {
      const connection = await prisma.slackConnection.findFirst({
        where: {
          tenantId: input.tenantId,
          webhookUrlCiphertext: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { webhookUrlCiphertext: true },
      });

      // Do not reserve the per-hour notification key if Slack is not connected.
      if (!connection?.webhookUrlCiphertext) return;
      const webhookUrl = decryptSlackSecret(connection.webhookUrlCiphertext);

      const dedupeKey = `reachinbox:slack:hourly-limit-notified:${input.senderId}:${input.hourWindowStart}`;
      const reservationToken = randomUUID();
      const reserved = await this.redis.set(
        dedupeKey,
        reservationToken,
        'PX',
        NOTIFICATION_KEY_TTL_MS,
        'NX',
      );
      if (reserved !== 'OK') return;

      const text = [
        'Email hourly limit reached',
        `Sender: ${input.senderEmail}`,
        `Limit: ${input.hourlyLimit} emails/hour`,
        `UTC window: ${new Date(input.hourWindowStart).toISOString()} to ${new Date(input.hourWindowStart + 3_600_000).toISOString()}`,
        `Scheduled emails will resume no earlier than ${new Date(input.retryAt).toISOString()}.`,
      ].join('\n');

      const slackResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
      const responseBody = await slackResponse.text();
      if (!slackResponse.ok || responseBody.trim() !== 'ok') {
        console.error('Slack hourly-limit notification was rejected.', {
          httpStatus: slackResponse.status,
        });
        return;
      }

      // Keep the key after any send attempt to avoid duplicate posts when the response is ambiguous.
      console.info('Slack hourly-limit notification sent.', {
        senderId: input.senderId,
        hourWindowStart: input.hourWindowStart,
      });
    } catch (error) {
      console.error('Slack hourly-limit notification failed; email processing will continue.', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        ...(safeErrorCode(error) ? { errorCode: safeErrorCode(error) } : {}),
      });
    }
  }
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('cause' in error)) return undefined;
  const cause = error.cause;
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return undefined;
  const code = cause.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}
