import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { EmailStatus } from '../types';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    compose: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"/><path d="M4 4h6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    slack: <><path d="M14.5 10a2 2 0 1 1 2-2v4"/><path d="M10 14.5a2 2 0 1 1 2 2H8"/><path d="M9.5 10a2 2 0 1 1-2 2V8"/><path d="M14 9.5a2 2 0 1 1-2-2h4"/><path d="M14 16a2 2 0 1 1-2 2v-4"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16v4H4v-4"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet'; className?: string }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function StatusBadge({ status }: { status: EmailStatus }) {
  const label: Record<EmailStatus, string> = { SCHEDULED: 'Scheduled', SENDING: 'Sending', SENT: 'Sent', FAILED: 'Failed' };
  return <span className={`status status-${status.toLowerCase()}`}><i aria-hidden="true" />{label[status]}</span>;
}

export function Avatar({ name, image, size = 'normal' }: { name: string | null; image: string | null; size?: 'normal' | 'large' }) {
  return image ? <img className={`avatar avatar-${size}`} src={image} alt="" /> : <span className={`avatar avatar-${size} avatar-fallback`}>{(name?.trim().charAt(0) || 'R').toUpperCase()}</span>;
}

export function EmptyState({ icon = 'send', title, detail, action }: { icon?: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22}/></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-stack" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}><i/><span><b/><em/></span><strong/></div>)}</div>;
}

export function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return <div className={`toast toast-${type}`} role={type === 'error' ? 'alert' : 'status'}><span className="toast-mark">{type === 'success' ? '✓' : '!'}</span><span>{message}</span><button aria-label="Dismiss notification" onClick={onClose}>×</button></div>;
}
