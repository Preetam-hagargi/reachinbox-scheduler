import { createHash, randomUUID } from 'node:crypto';
import { EmailStatus } from '@prisma/client';
import { Router } from 'express';
import { config } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { scheduleEmailJob } from '../../queue/email-queue-service.js';
import { requireAuth } from '../auth/auth-routes.js';

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const MAX_RECIPIENTS = 5000;

export const emailManagementRouter = Router();
emailManagementRouter.use(requireAuth);

emailManagementRouter.get('/senders', async (request, response) => {
  try {
    const senders = await prisma.sender.findMany({
      where: { tenantId: request.auth!.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, displayName: true },
    });
    response.json({ items: senders, limits: { minimumDelayMs: config.minEmailDelayMs, maximumEmailsPerHourPerSender: config.maxEmailsPerHourPerSender } });
  } catch {
    response.status(503).json({ error: 'Sender information is temporarily unavailable.' });
  }
});

emailManagementRouter.get('/scheduled', async (request, response) => {
  await listJobs(request.auth!.tenantId, [EmailStatus.SCHEDULED, EmailStatus.SENDING], request, response);
});

emailManagementRouter.get('/sent', async (request, response) => {
  await listJobs(request.auth!.tenantId, [EmailStatus.SENT, EmailStatus.FAILED], request, response);
});

emailManagementRouter.post('/schedule', async (request, response) => {
  const tenantId = request.auth!.tenantId;
  const userId = request.auth!.userId;
  const { senderId, recipients, subject, body, startAt, delaySeconds, hourlyLimit } = request.body ?? {};
  const idempotencyId = request.header('Idempotency-Key') ?? '';

  if (!isUuid(idempotencyId)) {
    response.status(400).json({ error: 'Idempotency-Key must be a UUID.' });
    return;
  }
  if (typeof senderId !== 'string' || !isUuid(senderId)) {
    response.status(400).json({ error: 'Choose a valid sender.' });
    return;
  }
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > MAX_RECIPIENTS
    || recipients.some((value: unknown) => typeof value !== 'string' || !EMAIL_PATTERN.test(value.trim()))) {
    response.status(400).json({ error: `Provide between 1 and ${MAX_RECIPIENTS} valid recipient email addresses.` });
    return;
  }
  if (new Set(recipients.map((value: string) => value.trim().toLowerCase())).size !== recipients.length) {
    response.status(400).json({ error: 'Remove duplicate recipient email addresses before scheduling.' });
    return;
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 998) {
    response.status(400).json({ error: 'Subject is required and must be 998 characters or fewer.' });
    return;
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 100_000) {
    response.status(400).json({ error: 'Message body is required and must be 100,000 characters or fewer.' });
    return;
  }
  if (!Number.isInteger(delaySeconds) || delaySeconds < Math.ceil(config.minEmailDelayMs / 1000) || delaySeconds > 86_400) {
    response.status(400).json({ error: `Delay must be at least ${Math.ceil(config.minEmailDelayMs / 1000)} seconds.` });
    return;
  }
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > config.maxEmailsPerHourPerSender) {
    response.status(400).json({ error: `Hourly limit must be between 1 and ${config.maxEmailsPerHourPerSender}.` });
    return;
  }
  const start = typeof startAt === 'string' ? new Date(startAt) : new Date(Number.NaN);
  if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() - 30_000) {
    response.status(400).json({ error: 'Start time must be a valid current or future time.' });
    return;
  }

  try {
    const sender = await prisma.sender.findFirst({ where: { id: senderId, tenantId }, select: { id: true } });
    if (!sender) {
      response.status(404).json({ error: 'The selected sender does not belong to this workspace.' });
      return;
    }
    const delayMs = delaySeconds * 1000;
    const normalizedRecipients = recipients.map((email: string) => email.trim().toLowerCase());
    const data = normalizedRecipients.map((recipientEmail: string, index: number) => ({
      tenantId,
      createdByUserId: userId,
      senderId,
      recipientEmail,
      subject: subject.trim(),
      body,
      idempotencyKey: `${idempotencyId}:${createHash('sha256').update(recipientEmail).digest('hex')}`,
      scheduledAt: new Date(start.getTime() + index * delayMs),
      minDelayMs: delayMs,
      maxEmailsPerHour: hourlyLimit,
    }));

    await prisma.emailJob.createMany({ data, skipDuplicates: true });
    const records = await prisma.emailJob.findMany({
      where: { tenantId, idempotencyKey: { in: data.map((item) => item.idempotencyKey) } },
      select: { id: true, recipientEmail: true, subject: true, body: true, senderId: true, idempotencyKey: true, scheduledAt: true, minDelayMs: true, maxEmailsPerHour: true, status: true },
    });
    const recordByKey = new Map(records.map((record) => [record.idempotencyKey, record]));
    for (const requested of data) {
      const saved = recordByKey.get(requested.idempotencyKey);
      if (!saved || saved.recipientEmail !== requested.recipientEmail || saved.subject !== requested.subject
        || saved.body !== requested.body || saved.senderId !== senderId
        || saved.scheduledAt.getTime() !== requested.scheduledAt.getTime()
        || saved.minDelayMs !== delayMs || saved.maxEmailsPerHour !== hourlyLimit) {
        response.status(409).json({ error: 'This Idempotency-Key was already used for a different schedule request.' });
        return;
      }
    }

    const scheduledIds: string[] = [];
    for (let offset = 0; offset < records.length; offset += 25) {
      const chunk = records.slice(offset, offset + 25).filter((record) => record.status === EmailStatus.SCHEDULED);
      const queued = await Promise.all(chunk.map(async (record) => {
        await scheduleEmailJob(record.id, record.scheduledAt);
        return record.id;
      }));
      scheduledIds.push(...queued);
    }
    response.status(202).json({
      idempotencyKey: idempotencyId,
      createdOrExistingCount: records.length,
      queuedCount: scheduledIds.length,
      scheduledIds,
    });
  } catch (error) {
    console.error('Email batch scheduling failed.', { error: error instanceof Error ? error.name : 'UnknownError' });
    response.status(503).json({ error: 'The campaign could not be fully queued. Retry with the same Idempotency-Key.' });
  }
});

async function listJobs(tenantId: string, statuses: EmailStatus[], request: Parameters<Parameters<typeof emailManagementRouter.get>[1]>[0], response: Parameters<Parameters<typeof emailManagementRouter.get>[1]>[1]): Promise<void> {
  const page = parsePage(request.query.page, 1);
  const limit = parsePage(request.query.limit, 50);
  if (!page || !limit || limit > 100) {
    response.status(400).json({ error: 'page must be positive and limit must be between 1 and 100.' });
    return;
  }
  try {
    const where = { tenantId, status: { in: statuses } };
    const [items, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        orderBy: statuses.includes(EmailStatus.SENT) ? { sentAt: 'desc' } : { scheduledAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, recipientEmail: true, subject: true, scheduledAt: true, sentAt: true, status: true, sender: { select: { email: true, displayName: true } } },
      }),
      prisma.emailJob.count({ where }),
    ]);
    response.json({ items, total, page, limit });
  } catch {
    response.status(503).json({ error: 'Email records are temporarily unavailable.' });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function parsePage(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
