import { prisma } from './db/prisma.js';
import { createEmailWorker } from './workers/email-worker.js';

const workerRuntime = createEmailWorker();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; closing email worker.`);

  await workerRuntime.close();
  await prisma.$disconnect();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
