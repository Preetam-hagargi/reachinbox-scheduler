import { prisma } from '../db/prisma.js';
import { closeEmailQueue } from '../queue/email-queue.js';
import { scheduleEmailJob } from '../queue/email-queue-service.js';

async function main(): Promise<void> {
  const emailJobId = process.argv[2];
  const scheduledAtArgument = process.argv[3];

  if (!emailJobId || !scheduledAtArgument) {
    throw new Error('Usage: npm run enqueue:email -- <emailJobId> <scheduledAt ISO timestamp>');
  }

  const scheduledAt = new Date(scheduledAtArgument);
  const bullJobId = await scheduleEmailJob(emailJobId, scheduledAt);
  console.info(`Queued EmailJob ${emailJobId} as BullMQ job ${bullJobId}.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeEmailQueue();
  await prisma.$disconnect();
}
