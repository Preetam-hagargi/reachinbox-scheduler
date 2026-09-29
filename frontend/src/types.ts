export type EmailStatus = 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED';

export interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface EmailRecord {
  id: string;
  recipientEmail: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  sender?: { email: string; displayName: string | null };
}

export interface Sender {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SenderCapacity extends Sender {
  usedThisHour: number;
  hourlyLimit: number;
  remainingThisHour: number;
  resetsAt: string;
}

export interface SlackStatus {
  connected: boolean;
  configured: boolean;
  workspace: { id: string; name: string | null } | null;
  channel: { id: string | null; name: string | null } | null;
  connectUrl: string;
}

export interface DashboardOverview {
  counts: Record<EmailStatus, number>;
  sentLast24h: number;
  senders: SenderCapacity[];
  upcoming: EmailRecord[];
  recent: EmailRecord[];
  limits: { minimumDelayMs: number; maximumEmailsPerHourPerSender: number };
}

export interface PagedEmails {
  items: EmailRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface EmailSearchResult extends EmailRecord {
  emailJobId: string;
  body: string;
}
