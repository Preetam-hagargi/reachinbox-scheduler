import type { DashboardOverview, EmailSearchResult, PagedEmails, Sender, SlackStatus, UserProfile } from '../types';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload;
}

export const api = {
  me: () => request<{ authenticated: boolean; user?: UserProfile; tenant?: { id: string; name: string } }>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  overview: () => request<DashboardOverview>('/api/dashboard/overview'),
  senders: () => request<{ items: Sender[]; limits: { minimumDelayMs: number; maximumEmailsPerHourPerSender: number } }>('/emails/senders'),
  scheduled: (page = 1) => request<PagedEmails>(`/emails/scheduled?page=${page}&limit=50`),
  sent: (page = 1) => request<PagedEmails>(`/emails/sent?page=${page}&limit=50`),
  slack: () => request<SlackStatus>('/slack/status'),
  disconnectSlack: () => request<{ disconnected: boolean }>('/slack/connection', { method: 'DELETE' }),
  search: (query: string) => request<{ items: EmailSearchResult[]; total: number; page: number; limit: number }>(`/emails/search?q=${encodeURIComponent(query)}&limit=50`),
  schedule: (input: { senderId: string; recipients: string[]; subject: string; body: string; startAt: string; delaySeconds: number; hourlyLimit: number }, idempotencyKey: string) => request<{ queuedCount: number; createdOrExistingCount: number }>('/emails/schedule', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }),
};
