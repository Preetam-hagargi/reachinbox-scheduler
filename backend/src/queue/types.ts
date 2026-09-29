export interface EmailJobPayload {
  emailJobId: string;
}

export type EmailJobProcessingResult = {
  status: 'sent' | 'failed' | 'skipped';
  emailJobId: string;
  reason?: string;
};
