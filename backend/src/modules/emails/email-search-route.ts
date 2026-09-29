import { Router } from 'express';
import { EmailStatus } from '@prisma/client';
import { requireAuth } from '../auth/auth-routes.js';
import { elasticsearchClient, EMAIL_JOBS_INDEX } from '../../integrations/elasticsearch/client.js';
import { ensureEmailJobsIndex, type IndexedEmailJob } from '../../integrations/elasticsearch/email-index.js';
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_PAGE,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_RESULT_WINDOW,
} from './search-constants.js';

export const emailSearchRouter = Router();
emailSearchRouter.use(requireAuth);

emailSearchRouter.get('/search', async (request, response) => {
  const tenantId = request.auth!.tenantId;

  const query = getStringQuery(request.query.q)?.trim() ?? '';
  const status = getStringQuery(request.query.status)?.trim().toUpperCase();
  const senderId = getStringQuery(request.query.senderId)?.trim();
  const page = parsePositiveInteger(request.query.page, DEFAULT_SEARCH_PAGE);
  const limit = parsePositiveInteger(request.query.limit, DEFAULT_SEARCH_LIMIT);

  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    response.status(400).json({ error: `q must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.` });
    return;
  }
  if (status && !Object.values(EmailStatus).includes(status as EmailStatus)) {
    response.status(400).json({ error: 'status must be SCHEDULED, SENDING, SENT, or FAILED.' });
    return;
  }
  if (senderId && !isUuid(senderId)) {
    response.status(400).json({ error: 'senderId must be a valid UUID.' });
    return;
  }
  if (
    page === undefined
    || limit === undefined
    || limit > MAX_SEARCH_LIMIT
    || (page - 1) * limit + limit > MAX_SEARCH_RESULT_WINDOW
  ) {
    response.status(400).json({ error: `page must be positive and limit must be between 1 and ${MAX_SEARCH_LIMIT}.` });
    return;
  }

  try {
    await ensureEmailJobsIndex();
    const result = await elasticsearchClient.search<IndexedEmailJob>({
      index: EMAIL_JOBS_INDEX,
      from: (page - 1) * limit,
      size: limit,
      query: {
        bool: {
          filter: [
            { term: { tenantId } },
            ...(status ? [{ term: { status } }] : []),
            ...(senderId ? [{ term: { senderId } }] : []),
          ],
          must: query
            ? [{ multi_match: { query, fields: ['recipientEmail', 'subject', 'body', 'status'] } }]
            : [{ match_all: {} }],
        },
      },
      sort: [{ scheduledAt: { order: 'desc' } }],
    });

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : result.hits.total?.value ?? 0;
    const items = result.hits.hits.flatMap((hit) => {
      const source = hit._source;
      return source ? [{
        emailJobId: source.emailJobId,
        recipientEmail: source.recipientEmail,
        subject: source.subject,
        body: source.body,
        status: source.status,
        scheduledAt: source.scheduledAt,
        sentAt: source.sentAt,
      }] : [];
    });
    response.json({ items, total, page, limit });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('Elasticsearch email search failed.', { error: errorName });
    response.status(503).json({ error: 'Email search is temporarily unavailable.' });
  }
});

function getStringQuery(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parsePositiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
