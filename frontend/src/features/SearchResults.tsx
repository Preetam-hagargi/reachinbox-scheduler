import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { EmailSearchResult } from '../types';
import { EmptyState, Skeleton, StatusBadge } from '../components/ui';
import { formatDate } from './Overview';

export function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<EmailSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.search(query).then((result) => { if (!cancelled) { setItems(result.items); setTotal(result.total); } }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Search is temporarily unavailable.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  return <div className="page-grid list-page"><section className="page-intro"><div><p className="eyebrow">ELASTICSEARCH <span>·</span> TENANT SCOPED</p><h2>Results for “{query}”</h2><p>Matching recipients, subjects, and message bodies.</p></div><div className="intro-count"><strong>{loading ? '—' : total}</strong><span>matches</span></div></section>
    <section className="panel table-panel">{loading ? <Skeleton rows={5}/> : error ? <div className="inline-error">{error}</div> : items.length ? <div className="search-result-list">{items.map((item) => <article className="search-result" key={item.emailJobId}><div className="search-result-top"><strong>{item.recipientEmail}</strong><StatusBadge status={item.status}/></div><h3>{item.subject}</h3><p>{item.body.slice(0, 210)}{item.body.length > 210 ? '…' : ''}</p><footer>Scheduled {formatDate(item.scheduledAt)}{item.sentAt ? ` · Sent ${formatDate(item.sentAt)}` : ''}</footer></article>)}</div> : <EmptyState icon="search" title="No emails matched your search" detail="Try a different recipient, subject, or phrase from the message body."/>}</section>
  </div>;
}
