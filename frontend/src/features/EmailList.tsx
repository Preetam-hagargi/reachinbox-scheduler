import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { EmailRecord, PagedEmails } from '../types';
import { Button, EmptyState, Icon, Skeleton, StatusBadge } from '../components/ui';
import { formatDate } from './Overview';

export function EmailList({ mode, onCompose }: { mode: 'scheduled' | 'sent'; onCompose: () => void }) {
  const [data, setData] = useState<PagedEmails | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const load = useCallback(async (page = 1, append = false) => {
    if (append) setMoreLoading(true); else setLoading(true);
    setError('');
    try {
      const result = mode === 'scheduled' ? await api.scheduled(page) : await api.sent(page);
      setData((current) => append && current ? { ...result, items: [...current.items, ...result.items] } : result);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Emails could not be loaded.'); }
    finally { setLoading(false); setMoreLoading(false); }
  }, [mode]);
  useEffect(() => { void load(); }, [load]);

  const scheduled = mode === 'scheduled';
  return <div className="page-grid list-page">
    <section className="page-intro"><div><p className="eyebrow">YOUR OUTBOX <span>·</span> {scheduled ? 'IN THE QUEUE' : 'DELIVERY HISTORY'}</p><h2>{scheduled ? 'A clear view of what’s next.' : 'Every send, accounted for.'}</h2><p>{scheduled ? 'Track messages as they move toward their send time.' : 'See delivered and failed messages from your workspace.'}</p></div><div className="intro-count"><strong>{data?.total ?? '—'}</strong><span>{scheduled ? 'queued emails' : 'email records'}</span></div></section>
    <section className="panel table-panel">
      <div className="table-toolbar"><div><h3>{scheduled ? 'Scheduled emails' : 'Sent emails'}</h3><p>Workspace records, updated when you refresh.</p></div><Button variant="secondary" onClick={() => void load(1)} disabled={loading}><Icon name="refresh" size={15}/> Refresh</Button></div>
      {loading ? <Skeleton rows={6}/> : error ? <div className="inline-error"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Try again</Button></div> : !data?.items.length ? <EmptyState icon={scheduled ? 'calendar' : 'send'} title={scheduled ? 'No emails are scheduled yet' : 'No emails have been sent yet'} detail={scheduled ? 'When you schedule a campaign, every recipient will appear here.' : 'Delivered and failed email records will appear here.'} action={scheduled ? <button className="text-link" onClick={onCompose}>Create your first campaign <Icon name="arrow" size={14}/></button> : undefined}/> : <EmailTable items={data.items} mode={mode}/>}
      {!loading && data && data.total > data.items.length && <div className="table-footnote">Showing {data.items.length} of {data.total.toLocaleString()} records. <button className="text-link" disabled={moreLoading} onClick={() => void load(data.page + 1, true)}>{moreLoading ? 'Loading…' : 'Load more'}</button></div>}
    </section>
  </div>;
}

function EmailTable({ items, mode }: { items: EmailRecord[]; mode: 'scheduled' | 'sent' }) {
  return <div className="email-table-wrap"><table className="email-table"><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>{mode === 'scheduled' ? 'SCHEDULED FOR' : 'SENT AT'}</th><th>STATUS</th></tr></thead><tbody>{items.map((email) => <tr key={email.id}><td><span className="recipient-cell"><i>{email.recipientEmail.charAt(0).toUpperCase()}</i><span>{email.recipientEmail}</span></span></td><td className="subject-cell">{email.subject}</td><td className="time-cell">{email.sentAt && mode === 'sent' ? formatDate(email.sentAt) : formatDate(email.scheduledAt)}</td><td><StatusBadge status={email.status}/></td></tr>)}</tbody></table></div>;
}
