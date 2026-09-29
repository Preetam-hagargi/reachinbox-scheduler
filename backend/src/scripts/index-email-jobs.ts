import { elasticsearchClient, EMAIL_JOBS_INDEX } from '../integrations/elasticsearch/client.js';
import { ensureEmailJobsIndex, toIndexedEmailJob } from '../integrations/elasticsearch/email-index.js';
import { prisma } from '../db/prisma.js';

const PAGE_SIZE = 500;

async function main(): Promise<void> {
  await ensureEmailJobsIndex();

  let cursor: string | undefined;
  let indexedCount = 0;

  while (true) {
    const emailJobs = await prisma.emailJob.findMany({
      take: PAGE_SIZE,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (emailJobs.length === 0) break;

    const operations = emailJobs.flatMap((emailJob) => [
      { index: { _index: EMAIL_JOBS_INDEX, _id: emailJob.id } },
      toIndexedEmailJob(emailJob),
    ]);
    const result = await elasticsearchClient.bulk({ operations, refresh: false });
    const errors = result.items.filter((item) => item.index?.error);
    if (errors.length > 0) {
      throw new Error(`Elasticsearch rejected ${errors.length} documents in a ${emailJobs.length}-record batch.`);
    }

    indexedCount += emailJobs.length;
    cursor = emailJobs[emailJobs.length - 1]?.id;
    console.info(`Indexed ${indexedCount} EmailJobs so far.`);
  }

  await elasticsearchClient.indices.refresh({ index: EMAIL_JOBS_INDEX });
  console.info(`Finished indexing ${indexedCount} EmailJobs into ${EMAIL_JOBS_INDEX}.`);
}

try {
  await main();
} catch (error) {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  console.error('EmailJob indexing failed. PostgreSQL data was not changed.', { error: errorName });
  process.exitCode = 1;
} finally {
  await elasticsearchClient.close();
  await prisma.$disconnect();
}
