import type { UserProfile } from '../types';
import { Avatar, Icon } from './ui';
import { API_BASE } from '../lib/api';

export type PageId = 'overview' | 'scheduled' | 'sent' | 'compose' | 'slack' | 'senders' | 'search';

const navigation: { title: string; items: { id: PageId; label: string; icon: string }[] }[] = [
  { title: 'WORKSPACE', items: [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'compose', label: 'Campaigns', icon: 'compose' },
    { id: 'scheduled', label: 'Scheduled', icon: 'calendar' },
    { id: 'sent', label: 'Sent', icon: 'send' },
  ] },
  { title: 'CONNECTIONS', items: [
    { id: 'slack', label: 'Slack', icon: 'slack' },
    { id: 'senders', label: 'Senders', icon: 'users' },
  ] },
];

export function Sidebar({ page, user, workspaceName, onNavigate, onLogout, mobileOpen, closeMobile }: {
  page: PageId; user: UserProfile; workspaceName: string; onNavigate: (page: PageId) => void; onLogout: () => void; mobileOpen: boolean; closeMobile: () => void;
}) {
  return <>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile}/>}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#overview" onClick={(e) => { e.preventDefault(); onNavigate('overview'); closeMobile(); }}><span className="brand-mark">r</span><span>reach<span>inbox</span></span></a>
      <div className="workspace-switch"><span className="workspace-avatar">{workspaceName.charAt(0).toUpperCase() || 'W'}</span><span className="workspace-copy"><small>WORKSPACE</small><strong>{workspaceName}</strong></span><span className="workspace-chevron">⌄</span></div>
      <nav className="side-navigation" aria-label="Main navigation">
        {navigation.map((group) => <div className="nav-group" key={group.title}><p className="nav-heading">{group.title}</p>{group.items.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { onNavigate(item.id); closeMobile(); }}><Icon name={item.icon}/><span>{item.label}</span></button>)}</div>)}
        <div className="nav-group"><p className="nav-heading">OPERATIONS</p><a className="nav-item" href={`${API_BASE}/admin/queues`} target="_blank" rel="noreferrer"><Icon name="grid"/><span>Queue Monitor</span></a></div>
      </nav>
      <div className="sidebar-bottom">
        <div className="plan-card"><span className="plan-spark">✳</span><p><strong>Your workspace</strong><span>Keep every send in sync.</span></p><button aria-label="Open workspace" onClick={() => onNavigate('overview')}><Icon name="arrow" size={15}/></button></div>
        <div className="user-card"><Avatar name={user.name} image={user.avatarUrl}/><span className="user-meta"><strong>{user.name || 'ReachInbox user'}</strong><small>{user.email}</small></span><button className="logout-button" onClick={onLogout} title="Log out" aria-label="Log out">↗</button></div>
      </div>
    </aside>
  </>;
}
