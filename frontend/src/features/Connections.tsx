import { useEffect, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Sender, SlackStatus } from '../types';
import { Button, EmptyState, Icon, Skeleton } from '../components/ui';

export function Connections({ mode, onToast }: { mode: 'slack' | 'senders'; onToast: (message: string, type?: 'success' | 'error') => void }) {
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const load = async () => {
    setLoading(true); setError('');
    try {
      if (mode === 'slack') setSlack(await api.slack());
      else setSenders((await api.senders()).items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection information is unavailable.'); }
    finally { setLoading(false); }
  };
  const disconnectSlack = async () => {
    setDisconnecting(true);
    try {
      await api.disconnectSlack();
      setSlack((current) => current ? { ...current, connected: false, workspace: null, channel: null } : current);
      onToast('Slack workspace disconnected.');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Slack could not be disconnected.', 'error');
    } finally {
      setDisconnecting(false);
    }
  };
  useEffect(() => { void load(); }, [mode]);

  if (loading) return <div className="page-grid"><Skeleton rows={3}/></div>;
  if (error) return <section className="panel error-panel"><p>{error}</p><Button variant="secondary" onClick={() => void load()}><Icon name="refresh"/> Try again</Button></section>;

  if (mode === 'slack') return <div className="page-grid list-page"><section className="page-intro"><div><p className="eyebrow">CONNECTIONS <span>·</span> NOTIFICATIONS</p><h2>Stay close to the signal.</h2><p>Connect the tools your email workflow already runs on.</p></div></section><section className="connection-feature panel"><div className="connection-orbit"><Icon name="slack" size={34}/></div><div className="connection-detail"><p className="eyebrow">SLACK WORKSPACE</p><h3>{slack?.connected ? slack.workspace?.name || 'Connected workspace' : 'Rate limit notifications'}</h3><p>{slack?.connected ? `Connected${slack.channel?.name ? ` to #${slack.channel.name}` : ''}. ReachInbox will notify this workspace when a sender hits its hourly ceiling.` : 'Get a real Slack message when a sender reaches its hourly sending limit. The notification is deduplicated for each sender and hour.'}</p>{slack?.connected && <span className="connection-state"><i/> Connected</span>}{!slack?.configured && <p className="connection-config-note">Slack OAuth credentials have not been configured on the backend.</p>}</div><div className="connection-actions">{slack?.connected && <Button variant="secondary" disabled={disconnecting} onClick={() => void disconnectSlack()}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</Button>}<Button disabled={disconnecting} onClick={() => { if (!slack?.configured) { onToast('Slack OAuth is not configured on the backend.', 'error'); return; } window.location.assign(`${API_BASE}${slack.connectUrl}`); }}>{slack?.connected ? 'Reconnect workspace' : 'Connect Slack'} <Icon name="arrow" size={16}/></Button></div></section></div>;

  return <div className="page-grid list-page"><section className="page-intro"><div><p className="eyebrow">CONNECTIONS <span>·</span> SENDING IDENTITY</p><h2>Your senders, in one place.</h2><p>Choose a verified sender for each campaign.</p></div><div className="intro-count"><strong>{senders.length}</strong><span>senders</span></div></section><section className="panel sender-list-panel"><div className="table-toolbar"><div><h3>Available senders</h3><p>Sender accounts configured for your workspace.</p></div></div>{senders.length ? senders.map((sender) => <div className="sender-list-row" key={sender.id}><span className="sender-icon"><Icon name="send"/></span><span><strong>{sender.displayName || sender.email}</strong><small>{sender.displayName ? sender.email : 'Ethereal SMTP sender'}</small></span><span className="connection-state"><i/> Available</span></div>) : <EmptyState icon="users" title="No senders have been added" detail="Sender setup is managed in the workspace database. Add a sender before composing a campaign."/>}</section></div>;
}
