import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { DashboardOverview, SlackStatus, UserProfile } from '../types';
import type { PageId } from '../components/Sidebar';
import { Button, EmptyState, Icon, Skeleton, StatusBadge } from '../components/ui';

export function Overview({ user, onNavigate, onToast }: { user: UserProfile; onNavigate: (page: PageId) => void; onToast: (message: string, type?: 'success' | 'error') => void }) {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedSenderId, setSelectedSenderId] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const [overview, slackStatus] = await Promise.all([api.overview(), api.slack().catch(() => null)]);
      setData(overview); setSlack(slackStatus);
      setSelectedSenderId((current) => overview.senders.some((sender) => sender.id === current) ? current : overview.senders[0]?.id ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dashboard data could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (loading) return <div className="page-grid"><Skeleton rows={5}/></div>;
  if (error || !data) return <section className="panel error-panel"><p>{error || 'Dashboard data is unavailable.'}</p><Button variant="secondary" onClick={() => void load()}><Icon name="refresh"/> Try again</Button></section>;

  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const active = data.counts.SCHEDULED + data.counts.SENDING;
  const capacity = data.senders.find((sender) => sender.id === selectedSenderId) ?? data.senders[0];
  const ratio = capacity ? Math.min(100, capacity.usedThisHour / capacity.hourlyLimit * 100) : 0;

  return <div className="page-grid overview-grid">
    <section className="hero-card">
      <div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-grain"/>
      <div className="hero-copy"><p className="eyebrow hero-eyebrow"><span className="live-indicator"/> YOUR PIPELINE, IN MOTION</p><h2>{greeting}, {firstName}<span>.</span></h2><p>Here's what's moving through your email pipeline.</p><div className="hero-actions"><Button onClick={() => onNavigate('compose')}>＋ Compose campaign <Icon name="arrow" size={16}/></Button><button className="hero-link" onClick={() => onNavigate('slack')}>Connections <Icon name="arrow" size={15}/></button></div></div>
      <div className="hero-stamp"><span>OUTBOX</span><strong>RI<span>·</span>01</strong><small>EMAIL OPERATIONS</small></div>
    </section>

    <section className="panel activity-panel">
      <div className="panel-heading"><div><p className="eyebrow">LIVE PIPELINE</p><h3>Email activity</h3></div><span className="sync-label"><i/> All systems</span></div>
      <div className="activity-total"><strong>{active.toLocaleString()}</strong><span>in the queue</span><div className="activity-total-note"><b>{data.sentLast24h}</b> sent in the last 24 hours</div></div>
      <div className="activity-bar" aria-label={`${data.counts.SENT} sent, ${data.counts.SCHEDULED} scheduled, ${data.counts.FAILED} failed`}>
        <span className="bar-sent" style={{ width: `${barWidth(data.counts.SENT, data.counts)}%` }}/><span className="bar-scheduled" style={{ width: `${barWidth(data.counts.SCHEDULED + data.counts.SENDING, data.counts)}%` }}/><span className="bar-failed" style={{ width: `${barWidth(data.counts.FAILED, data.counts)}%` }}/>
      </div>
      <div className="activity-legend"><span><i className="legend-sent"/> Sent <b>{data.counts.SENT}</b></span><span><i className="legend-scheduled"/> Scheduled <b>{data.counts.SCHEDULED + data.counts.SENDING}</b></span><span><i className="legend-failed"/> Failed <b>{data.counts.FAILED}</b></span></div>
    </section>

    <section className="panel capacity-panel">
      <div className="panel-heading"><div><p className="eyebrow">SENDER CAPACITY</p><h3>Hourly allowance</h3></div>{data.senders.length > 1 ? <select className="capacity-select" aria-label="Select sender capacity" value={capacity?.id ?? ''} onChange={(event) => setSelectedSenderId(event.target.value)}>{data.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.email}</option>)}</select> : <span className="capacity-icon"><Icon name="send" size={17}/></span>}</div>
      {capacity ? <><div className="capacity-numbers"><strong>{capacity.usedThisHour}<small> / {capacity.hourlyLimit}</small></strong><span>emails reserved</span></div><div className="capacity-track"><span style={{ width: `${ratio}%` }}/></div><div className="capacity-foot"><span>{capacity.email}</span><span>Resets {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(capacity.resetsAt))}</span></div></> : <EmptyState icon="users" title="No senders connected" detail="A sender is needed before you can schedule emails."/>}
    </section>

    <section className="panel list-panel upcoming-panel"><div className="panel-heading"><div><p className="eyebrow">NEXT IN LINE</p><h3>Up next</h3></div><button className="text-link" onClick={() => onNavigate('scheduled')}>View queue <Icon name="arrow" size={14}/></button></div>
      {data.upcoming.length ? <div className="compact-list">{data.upcoming.map((email) => <div className="compact-row" key={email.id}><span className="mail-avatar">{email.recipientEmail.charAt(0).toUpperCase()}</span><span className="compact-main"><strong>{email.recipientEmail}</strong><small>{email.subject}</small></span><span className="compact-time">{formatDate(email.scheduledAt)}</span></div>)}</div> : <EmptyState icon="calendar" title="Nothing waiting in the queue" detail="Your next campaign will appear here." action={<button className="text-link" onClick={() => onNavigate('compose')}>Schedule your first campaign <Icon name="arrow" size={14}/></button>}/>}
    </section>

    <section className="panel list-panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Recently delivered</h3></div><button className="text-link" onClick={() => onNavigate('sent')}>View sent <Icon name="arrow" size={14}/></button></div>
      {data.recent.length ? <div className="compact-list">{data.recent.map((email) => <div className="compact-row" key={email.id}><span className={`mail-avatar ${email.status === 'FAILED' ? 'mail-avatar-failed' : ''}`}>{email.status === 'FAILED' ? '!' : '✓'}</span><span className="compact-main"><strong>{email.recipientEmail}</strong><small>{email.subject}</small></span><span className="compact-status"><StatusBadge status={email.status}/><small>{email.sentAt ? formatDate(email.sentAt) : '—'}</small></span></div>)}</div> : <EmptyState icon="send" title="No messages delivered yet" detail="Once a campaign sends, it will show up here."/>}
    </section>

    <section className={`slack-card ${slack?.connected ? 'slack-connected' : ''}`}><span className="slack-symbol"><Icon name="slack" size={21}/></span><div className="slack-content"><p className="eyebrow">TEAM NOTIFICATIONS</p><h3>{slack?.connected ? 'Slack is connected' : 'Keep your team in the loop'}</h3><p>{slack?.connected ? `${slack.workspace?.name || 'Workspace'}${slack.channel?.name ? ` · #${slack.channel.name}` : ''}` : 'Get notified when a sender reaches its hourly limit.'}</p></div><Button variant="secondary" onClick={() => slack?.connected ? onToast('Slack is connected to this workspace.') : slack?.configured ? window.location.assign(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}${slack.connectUrl}`) : onToast('Slack OAuth is not configured on the backend.', 'error')}>{slack?.connected ? 'Connected' : 'Connect Slack'} <Icon name="arrow" size={15}/></Button></section>
  </div>;
}

function barWidth(value: number, counts: DashboardOverview['counts']): number {
  const total = counts.SCHEDULED + counts.SENDING + counts.SENT + counts.FAILED;
  return total === 0 ? 0 : Math.max(value > 0 ? 3 : 0, value / total * 100);
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
