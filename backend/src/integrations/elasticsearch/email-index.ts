import type { EmailJob } from '@prisma/client';
import { elasticsearchClient, EMAIL_JOBS_INDEX } from './client.js';

export interface IndexedEmailJob {
  emailJobId: string;
  tenantId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  senderId: string;
  createdByUserId: string;
  createdAt: string;
  failureReason: string | null;
}

let indexReady: Promise<void> | undefined;

export function ensureEmailJobsIndex(): Promise<void> {
  if (!indexReady) {
    indexReady = createIndexIfMissing().catch((error: unknown) => {
      indexReady = undefined;
      throw error;
    });
  }
  return indexReady;
}

async function createIndexIfMissing(): Promise<void> {
  if (await elasticsearchClient.indices.exists({ index: EMAIL_JOBS_INDEX })) return;

  try {
    await elasticsearchClient.indices.create({
      index: EMAIL_JOBS_INDEX,
      mappings: {
        properties: {
          emailJobId: { type: 'keyword' },
          tenantId: { type: 'keyword' },
          recipientEmail: {
            type: 'text',
            fields: { keyword: { type: 'keyword' } },
          },
          subject: { type: 'text' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          senderId: { type: 'keyword' },
          createdByUserId: { type: 'keyword' },
          createdAt: { type: 'date' },
          failureReason: { type: 'text' },
        },
      },
    });
  } catch (error) {
    if (isAlreadyExists(error)) return;
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    meta?: { body?: { error?: { type?: string } } };
  };
  return candidate.name === 'resource_already_exists_exception'
    || candidate.meta?.body?.error?.type === 'resource_already_exists_exception';
}

export function toIndexedEmailJob(emailJob: EmailJob): IndexedEmailJob {
  return {
    emailJobId: emailJob.id,
    tenantId: emailJob.tenantId,
    recipientEmail: emailJob.recipientEmail,
    subject: emailJob.subject,
    body: emailJob.body,
    status: emailJob.status,
    scheduledAt: emailJob.scheduledAt.toISOString(),
    sentAt: emailJob.sentAt?.toISOString() ?? null,
    senderId: emailJob.senderId,
    createdByUserId: emailJob.createdByUserId,
    createdAt: emailJob.createdAt.toISOString(),
    failureReason: emailJob.failureReason,
  };
}

export async function indexEmailJob(emailJob: EmailJob): Promise<void> {
  await ensureEmailJobsIndex();
  await elasticsearchClient.index({
    index: EMAIL_JOBS_INDEX,
    id: emailJob.id,
    document: toIndexedEmailJob(emailJob),
  });
}
