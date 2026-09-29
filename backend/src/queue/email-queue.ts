import { Queue } from 'bullmq';
import { EMAIL_QUEUE_NAME } from './constants.js';
import type { EmailJobPayload } from './types.js';
import { createRedisConnection } from './redis-connection.js';

export { EMAIL_QUEUE_NAME } from './constants.js';

const connection = createRedisConnection();

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection,
});

export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
  if (connection.status !== 'end') {
    await connection.quit();
  }
}
