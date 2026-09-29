import { prisma } from '../../db/prisma.js';
import { indexEmailJob } from './email-index.js';

export async function indexEmailJobByIdSafely(
  emailJobId: string,
  reason: 'scheduled' | 'sent' | 'failed',
): Promise<void> {
  try {
    const emailJob = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
    if (!emailJob) {
      console.warn(`Elasticsearch indexing skipped: EmailJob ${emailJobId} no longer exists.`);
      return;
    }
    await indexEmailJob(emailJob);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`EmailJob ${emailJobId} (${reason}) was not indexed in Elasticsearch.`, {
      error: errorName,
      note: 'PostgreSQL remains authoritative; run the search:index backfill after Elasticsearch recovers.',
    });
  }
}
