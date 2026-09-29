import { useState } from 'react';
import type { UserProfile } from '../types';
import type { PageId } from './Sidebar';
import { Avatar, Button, Icon } from './ui';

const title: Record<PageId, string> = { overview: 'Overview', scheduled: 'Scheduled emails', sent: 'Sent emails', compose: 'New campaign', slack: 'Connections', senders: 'Senders', search: 'Search results' };

export function Header({ page, user, onMenu, onCompose, onSearch }: { page: PageId; user: UserProfile; onMenu: () => void; onCompose: () => void; onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('');
  return <header className="topbar">
    <div className="topbar-left"><button className="mobile-menu" aria-label="Open navigation" onClick={onMenu}><Icon name="menu"/></button><div><p className="eyebrow">EMAIL OPERATIONS <span>·</span> WORKSPACE</p><h1>{title[page]}</h1></div></div>
    <div className="topbar-actions">
      <form className="search-box" onSubmit={(e) => { e.preventDefault(); onSearch(query.trim()); }}><Icon name="search" size={17}/><input aria-label="Search recipients and subjects" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipients, subjects..."/><kbd>↵</kbd></form>
      {page !== 'compose' && <Button className="top-compose" onClick={onCompose}><span>＋</span> Compose campaign</Button>}
      <div className="top-user"><Avatar name={user.name} image={user.avatarUrl}/><span className="top-user-name">{user.name?.split(' ')[0] || 'Account'}</span></div>
    </div>
  </header>;
}
