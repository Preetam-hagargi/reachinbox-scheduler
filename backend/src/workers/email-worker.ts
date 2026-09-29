import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { EMAIL_QUEUE_NAME } from '../queue/constants.js';
import { createRedisConnection } from '../queue/redis-connection.js';
import type { EmailJobPayload, EmailJobProcessingResult } from '../queue/types.js';
import { processEmailJob } from './process-email-job.js';
import { SenderSendGate } from './sender-send-gate.js';
import { SlackHourlyLimitNotifier } from '../integrations/slack/hourly-limit-notifier.js';

export interface EmailWorkerRuntime {
  worker: Worker<EmailJobPayload, EmailJobProcessingResult>;
  close(): Promise<void>;
}

export function createEmailWorker(): EmailWorkerRuntime {
  const connection = createRedisConnection();
  const sendGateConnection = createRedisConnection();
  const sendGate = new SenderSendGate(
    sendGateConnection,
    config.minEmailDelayMs,
    config.maxEmailsPerHourPerSender,
  );
  const slackNotifier = new SlackHourlyLimitNotifier(sendGateConnection);
  const worker = new Worker<EmailJobPayload, EmailJobProcessingResult>(
    EMAIL_QUEUE_NAME,
    (job, token) => processEmailJob(job, token, sendGate, slackNotifier),
    {
      connection,
      concurrency: config.workerConcurrency,
    },
  );

  worker.on('ready', () => {
    console.info(`Email worker ready with concurrency ${config.workerConcurrency}.`);
  });
  worker.on('completed', (job, result) => {
    console.info(`Queue job ${job.id} completed with result ${result.status}.`);
  });
  worker.on('failed', (job, error) => {
    console.error(`Queue job ${job?.id ?? '(unknown)'} failed:`, error.message);
  });
  worker.on('error', (error) => {
    console.error('Email worker error:', error.message);
  });

  return {
    worker,
    async close() {
      await worker.close();
      await quitConnection(connection);
      await quitConnection(sendGateConnection);
    },
  };
}

async function quitConnection(connection: Redis): Promise<void> {
  if (connection.status !== 'end') {
    await connection.quit();
  }
}
