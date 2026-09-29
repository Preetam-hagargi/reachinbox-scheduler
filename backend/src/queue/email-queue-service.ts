import { EmailStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { indexEmailJobByIdSafely } from '../integrations/elasticsearch/email-indexing.js';
import { emailQueue } from './email-queue.js';

export async function scheduleEmailJob(
  emailJobId: string,
  scheduledAt: Date,
): Promise<string> {
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new Error('scheduledAt must be a valid date.');
  }

  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    select: { id: true, status: true, scheduledAt: true },
  });

  if (!emailJob) {
    throw new Error(`EmailJob ${emailJobId} does not exist.`);
  }

  if (emailJob.status !== EmailStatus.SCHEDULED) {
    throw new Error(`EmailJob ${emailJobId} is not in SCHEDULED state.`);
  }

  if (emailJob.scheduledAt.getTime() !== scheduledAt.getTime()) {
    throw new Error(`scheduledAt does not match EmailJob ${emailJobId}.`);
  }

  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const bullJob = await emailQueue.add(
    'process-email',
    { emailJobId },
    {
      jobId: `email-${emailJobId}`,
      delay,
    },
  );

  await indexEmailJobByIdSafely(emailJobId, 'scheduled');

  return bullJob.id ?? `email-${emailJobId}`;
}
