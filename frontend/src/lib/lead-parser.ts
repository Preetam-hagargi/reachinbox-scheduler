export interface ParsedLeads {
  emails: string[];
  duplicates: number;
  malformedLines: number;
  fileName: string;
}

const EMAIL_CANDIDATE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

export function parseLeadText(text: string, fileName: string): ParsedLeads {
  const found = text.match(EMAIL_CANDIDATE) ?? [];
  const normalized = found.map(cleanCandidate).filter(isValidEmail);
  const emails = [...new Set(normalized)];
  const malformedLines = text.split(/\r?\n/).filter((line) => {
    if (!line.includes('@')) return false;
    const lineCandidates = line.match(EMAIL_CANDIDATE) ?? [];
    return !lineCandidates.map(cleanCandidate).some(isValidEmail);
  }).length;
  return { emails, duplicates: normalized.length - emails.length, malformedLines, fileName };
}

function cleanCandidate(value: string): string {
  return value.replace(/[),;:'"\].]+$/, '').toLowerCase();
}

function isValidEmail(value: string): boolean {
  const [local, domain, ...extra] = value.split('@');
  if (extra.length || !local || !domain || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
