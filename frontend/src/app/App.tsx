import { useCallback, useEffect, useState } from 'react';
import { API_BASE, api } from '../lib/api';
import type { UserProfile } from '../types';
import { Header } from '../components/Header';
import { Sidebar, type PageId } from '../components/Sidebar';
import { Button, Icon, Toast } from '../components/ui';
import { Overview } from '../features/Overview';
import { EmailList } from '../features/EmailList';
import { Compose } from '../features/Compose';
import { Connections } from '../features/Connections';
import { SearchResults } from '../features/SearchResults';

interface SessionData { authenticated: boolean; user?: UserProfile; tenant?: { id: string; name: string } }

const validPages: PageId[] = ['overview', 'scheduled', 'sent', 'compose', 'slack', 'senders', 'search'];

export function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [page, setPage] = useState<PageId>(parsePage());
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadSession = useCallback(async () => {
    setSessionError('');
    try { setSession(await api.me()); }
    catch (cause) {
      if (cause instanceof Error && /401/.test(cause.message)) setSession({ authenticated: false });
      else setSessionError(cause instanceof Error ? cause.message : 'Authentication service is unavailable.');
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    const syncPage = () => setPage(parsePage());
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigate = (next: PageId) => {
    window.location.hash = next === 'overview' ? 'overview' : next;
    setPage(next); setMobileOpen(false);
  };
  const notify = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('slack')) return;
    notify(params.get('slack') === 'connected' ? 'Slack workspace connected.' : 'Slack connection could not be completed.', params.get('slack') === 'connected' ? 'success' : 'error');
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }, []);
  const logout = async () => {
    try { await api.logout(); setSession({ authenticated: false }); navigate('overview'); notify('You have been signed out.'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Logout failed. Try again.', 'error'); }
  };
  const search = (query: string) => {
    if (!query) return;
    setSearchQuery(query); navigate('search');
  };

  if (!session) return <main className="auth-loading"><div className="auth-mark">r</div><span className="loading-dots">Loading your workspace</span>{sessionError && <Button variant="secondary" onClick={() => void loadSession()}>Try again</Button>}</main>;
  if (!session.authenticated || !session.user) return <LoginScreen apiBase={API_BASE} error={sessionError} onRetry={() => void loadSession()}/>;

  return <div className="app-shell">
    <Sidebar page={page} user={session.user} workspaceName={session.tenant?.name ?? 'Workspace'} onNavigate={navigate} onLogout={() => void logout()} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)}/>
    <div className="main-column"><Header page={page} user={session.user} onMenu={() => setMobileOpen(true)} onCompose={() => navigate('compose')} onSearch={search}/>
      <main className="main-content" key={page}>
        {page === 'overview' && <Overview user={session.user} onNavigate={navigate} onToast={notify}/>}
        {page === 'scheduled' && <EmailList mode="scheduled" onCompose={() => navigate('compose')}/>}
        {page === 'sent' && <EmailList mode="sent" onCompose={() => navigate('compose')}/>}
        {page === 'compose' && <Compose onNavigate={navigate} onToast={notify}/>}
        {page === 'slack' && <Connections mode="slack" onToast={notify}/>}
        {page === 'senders' && <Connections mode="senders" onToast={notify}/>}
        {page === 'search' && <SearchResults query={searchQuery}/>}
      </main>
      <footer className="app-footer"><span>REACHINBOX <b>·</b> EMAIL OPERATIONS</span><span>Private workspace <i/></span></footer>
    </div>
    {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}
  </div>;
}

function LoginScreen({ apiBase, error, onRetry }: { apiBase: string; error: string; onRetry: () => void }) {
  return <main className="login-screen"><div className="login-decoration"><div className="login-sun"/><div className="login-lines"/><span className="login-edition">OUTBOX LABS <i/> 01 — 26</span><div className="login-art-copy"><p className="eyebrow">A BETTER WAY TO REACH OUT</p><h1>Make every<br/>message <em>matter.</em></h1><p>Thoughtful email operations, from the first draft to the final delivery.</p></div><div className="login-art-caption"><span>THE REACHINBOX WAY</span><span>LESS NOISE. MORE MOMENTUM.</span></div></div><section className="login-panel"><a className="brand login-brand" href="#"><span className="brand-mark">r</span><span>reach<span>inbox</span></span></a><div className="login-form"><p className="eyebrow">YOUR WORKSPACE AWAITS</p><h2>Email operations,<br/>without the busywork.</h2><p className="login-description">Sign in to see what’s scheduled, what’s sent, and what’s next.</p>{error && <div className="form-alert" role="alert">{error}</div>}<a className="google-button" href={`${apiBase}/auth/google`}><GoogleGlyph/>Continue with Google<Icon name="arrow" size={17}/></a><p className="login-legal">By continuing, you’ll sign in with your Google account.<br/>Your workspace data stays private.</p>{error && <button className="text-link retry-link" onClick={onRetry}>Check sign-in again <Icon name="refresh" size={14}/></button>}</div><div className="login-footer"><span>REACHINBOX © 2026</span><span>SECURE GOOGLE SIGN-IN</span></div></section></main>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#34A853" d="M24 44c5.6 0 10.3-1.9 13.7-5.1L31 33.8c-1.9 1.3-4.2 2-7 2-5.4 0-10-3.6-11.7-8.4H5.4v5.2A20.7 20.7 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.3 27.4a12.4 12.4 0 0 1 0-7.8v-5.2H5.4a20.4 20.4 0 0 0 0 18.2l6.9-5.2Z"/><path fill="#EA4335" d="M24 11.2c3 0 5.7 1 7.8 3.1l5.9-5.9A19.7 19.7 0 0 0 24 2 20.7 20.7 0 0 0 5.4 14.4l6.9 5.2c1.7-4.8 6.3-8.4 11.7-8.4Z"/></svg>;
}

function parsePage(): PageId {
  const candidate = window.location.hash.replace(/^#/, '') as PageId;
  return validPages.includes(candidate) ? candidate : 'overview';
}
