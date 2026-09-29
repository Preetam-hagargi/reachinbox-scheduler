import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../auth/auth-routes.js';
import { emailQueue } from '../../queue/email-queue.js';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const emailQueueAdapter = new BullMQAdapter(emailQueue, {
  readOnlyMode: true,
  description: 'Scheduled email delivery jobs',
});

// The queue payload is intentionally limited to an EmailJob ID. Keep Bull Board
// from exposing any future fields that may be added to BullMQ job data/results.
emailQueueAdapter.setFormatter('data', (data) => ({
  emailJobId: typeof data?.emailJobId === 'string' ? data.emailJobId : undefined,
}));
emailQueueAdapter.setFormatter('returnValue', () => null);

createBullBoard({
  queues: [emailQueueAdapter],
  serverAdapter,
});

export const bullBoardRouter = Router();
bullBoardRouter.use(requireAuth, requireBullBoardAdmin, serverAdapter.getRouter());

async function requireBullBoardAdmin(request: Request, response: Response, next: NextFunction): Promise<void> {
  const identity = request.auth;
  if (!identity) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  if (!config.bullBoardAdminEmail) {
    response.status(503).json({ error: 'BullMQ dashboard is not configured.' });
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: { id: identity.userId, tenantId: identity.tenantId },
      select: { email: true },
    });
    if (!user) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.email.trim().toLowerCase() !== config.bullBoardAdminEmail) {
      response.status(403).json({ error: 'Administrator access required.' });
      return;
    }
    next();
  } catch {
    response.status(503).json({ error: 'BullMQ dashboard authorization is temporarily unavailable.' });
  }
}
