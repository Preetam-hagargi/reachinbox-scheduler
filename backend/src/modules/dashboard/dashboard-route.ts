import { EmailStatus } from '@prisma/client';
import { Router } from 'express';
import { config } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/redis-connection.js';
import { requireAuth } from '../auth/auth-routes.js';

const redis = createRedisConnection();
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/overview', async (request, response) => {
  const tenantId = request.auth!.tenantId;
  try {
    const [groups, senders, upcoming, recent, sentLast24h] = await Promise.all([
      prisma.emailJob.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      prisma.sender.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, displayName: true } }),
      prisma.emailJob.findMany({ where: { tenantId, status: { in: [EmailStatus.SCHEDULED, EmailStatus.SENDING] }, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 6, select: { id: true, recipientEmail: true, subject: true, scheduledAt: true, status: true } }),
      prisma.emailJob.findMany({ where: { tenantId, status: { in: [EmailStatus.SENT, EmailStatus.FAILED] } }, orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }], take: 6, select: { id: true, recipientEmail: true, subject: true, sentAt: true, status: true } }),
      prisma.emailJob.count({ where: { tenantId, status: EmailStatus.SENT, sentAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);

    const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const windowEnd = windowStart + 3_600_000;
    const capacities = await Promise.all(senders.map(async (sender) => {
      const key = `reachinbox:send-gate:sender:${sender.id}:quota:hour:${windowStart}`;
      const used = Number(await redis.get(key) ?? '0');
      return {
        ...sender,
        usedThisHour: Number.isFinite(used) ? used : 0,
        hourlyLimit: config.maxEmailsPerHourPerSender,
        remainingThisHour: Math.max(0, config.maxEmailsPerHourPerSender - (Number.isFinite(used) ? used : 0)),
        resetsAt: new Date(windowEnd).toISOString(),
      };
    }));

    const counts = Object.fromEntries(Object.values(EmailStatus).map((status) => [status, 0])) as Record<EmailStatus, number>;
    for (const group of groups) counts[group.status] = group._count._all;
    response.json({
      counts,
      sentLast24h,
      senders: capacities,
      upcoming,
      recent,
      limits: { minimumDelayMs: config.minEmailDelayMs, maximumEmailsPerHourPerSender: config.maxEmailsPerHourPerSender },
    });
  } catch {
    response.status(503).json({ error: 'Dashboard data is temporarily unavailable.' });
  }
});
