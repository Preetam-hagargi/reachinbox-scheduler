import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { parseLeadText, type ParsedLeads } from '../lib/lead-parser';
import type { Sender } from '../types';
import { Button, Icon, Skeleton } from '../components/ui';
import type { PageId } from '../components/Sidebar';

export function Compose({ onNavigate, onToast }: { onNavigate: (page: PageId) => void; onToast: (message: string, type?: 'success' | 'error') => void }) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [limits, setLimits] = useState({ minimumDelayMs: 2000, maximumEmailsPerHourPerSender: 200 });
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState(localDateTime(new Date(Date.now() + 60_000)));
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [leads, setLeads] = useState<ParsedLeads | null>(null);
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.senders().then(({ items, limits: backendLimits }) => {
      setSenders(items); setLimits(backendLimits);
      setSenderId(items[0]?.id ?? '');
      setDelaySeconds(Math.ceil(backendLimits.minimumDelayMs / 1000));
      setHourlyLimit(backendLimits.maximumEmailsPerHourPerSender);
    }).catch((cause: unknown) => setFormError(cause instanceof Error ? cause.message : 'Sender information could not be loaded.')).finally(() => setLoading(false));
  }, []);

  const changed = () => { idempotencyKey.current = null; setFormError(''); };
  const readFile = async (file?: File) => {
    if (!file) return;
    changed(); setFileError('');
    if (!/\.(csv|txt)$/i.test(file.name)) { setLeads(null); setFileError('Choose a .csv or .txt file.'); return; }
    try {
      const text = await file.text();
      if (!text.trim()) { setLeads(null); setFileError('This file is empty. Add at least one email address.'); return; }
      const parsed = parseLeadText(text, file.name);
      if (!parsed.emails.length) { setLeads(null); setFileError('No valid email addresses were found. Check the file and try again.'); return; }
      setLeads(parsed);
    } catch { setLeads(null); setFileError('The file could not be read. Try saving it as UTF-8 CSV or TXT.'); }
  };

  const schedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!leads?.emails.length) { setFileError('Upload a CSV or TXT file with at least one valid email address.'); return; }
    if (!senderId) { setFormError('No sender is available for this workspace.'); return; }
    if (!subject.trim()) { setFormError('Add a subject before scheduling.'); return; }
    if (!body.trim()) { setFormError('Write a message before scheduling.'); return; }
    const start = new Date(startAt);
    if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() - 30_000) { setFormError('Choose a valid start time in the future.'); return; }
    if (!Number.isInteger(delaySeconds) || delaySeconds * 1000 < limits.minimumDelayMs) { setFormError(`Delay must be at least ${Math.ceil(limits.minimumDelayMs / 1000)} seconds.`); return; }
    if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > limits.maximumEmailsPerHourPerSender) { setFormError(`Hourly limit must be between 1 and ${limits.maximumEmailsPerHourPerSender}.`); return; }

    idempotencyKey.current ??= crypto.randomUUID();
    setSaving(true);
    try {
      const result = await api.schedule({ senderId, recipients: leads.emails, subject: subject.trim(), body, startAt: start.toISOString(), delaySeconds, hourlyLimit }, idempotencyKey.current);
      idempotencyKey.current = null;
      onToast(`${result.createdOrExistingCount.toLocaleString()} emails added to your schedule.`);
      onNavigate('scheduled');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'The campaign could not be scheduled. Retry to try again.'); }
    finally { setSaving(false); }
  };

  if (loading) return <Skeleton rows={5}/>;
  return <div className="page-grid compose-page">
    <div className="compose-title"><button className="back-link" onClick={() => onNavigate('overview')}>← <span>Back to overview</span></button><div className="compose-title-row"><div><p className="eyebrow">CAMPAIGN WORKSPACE <span>·</span> NEW DRAFT</p><h2>Make the next move.</h2><p>One thoughtful message, sent at the right pace.</p></div><span className="draft-mark">DRAFT <i/></span></div></div>
    {formError && <div className="form-alert" role="alert"><span>!</span>{formError}</div>}
    <form className="compose-layout" onSubmit={(event) => void schedule(event)}>
      <div className="compose-main-column">
        <section className="panel compose-section"><div className="section-heading"><span className="section-number">01</span><div><p className="eyebrow">RECIPIENTS</p><h3>Who are we reaching?</h3></div><span className="step-check">1</span></div>
          <div className={`dropzone ${dragging ? 'dropzone-active' : ''} ${leads ? 'dropzone-loaded' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}>
            <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Upload CSV or TXT lead file" onChange={(event) => void readFile(event.target.files?.[0])}/>
            <span className="upload-icon"><Icon name={leads ? 'check' : 'upload'} size={20}/></span>
            {leads ? <><h4>{leads.emails.length.toLocaleString()} email addresses detected</h4><p>{leads.fileName}{leads.duplicates ? ` · ${leads.duplicates} duplicates removed` : ''}{leads.malformedLines ? ` · ${leads.malformedLines} malformed lines skipped` : ''}</p><button type="button" className="text-link" onClick={() => fileInput.current?.click()}>Replace file</button></> : <><h4>Drop your leads here, or <button type="button" className="browse-link" onClick={() => fileInput.current?.click()}>browse files</button></h4><p>CSV or TXT · email addresses are deduplicated before scheduling</p><span className="file-types"><b>.CSV</b><b>.TXT</b></span></>}
          </div>
          {fileError && <p className="field-error" role="alert">{fileError}</p>}
          {senders.length > 1 && <label className="field sender-field"><span>FROM SENDER</span><select value={senderId} onChange={(event) => { changed(); setSenderId(event.target.value); }}>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.displayName ? `${sender.displayName} · ` : ''}{sender.email}</option>)}</select></label>}
          {senders.length === 1 && <p className="single-sender"><span>FROM SENDER</span><strong>{senders[0].displayName ? `${senders[0].displayName} · ` : ''}{senders[0].email}</strong></p>}
          {!senders.length && !formError && <div className="sender-empty"><Icon name="users"/><span>No sender is configured for this workspace. Ask your workspace administrator to add a sender before scheduling.</span></div>}
        </section>

        <section className="panel compose-section message-section"><div className="section-heading"><span className="section-number">02</span><div><p className="eyebrow">YOUR MESSAGE</p><h3>Say it with intention.</h3></div><span className="step-check">2</span></div>
          <label className="field"><span>SUBJECT</span><input value={subject} onChange={(event) => { changed(); setSubject(event.target.value); }} placeholder="A clear subject gets you opened" maxLength={998}/><small>{subject.length}/998</small></label>
          <label className="field body-field"><span>MESSAGE</span><textarea value={body} onChange={(event) => { changed(); setBody(event.target.value); }} placeholder="Write a personal, purposeful message…" rows={10} maxLength={100000}/><small>Plain text message</small></label>
        </section>
      </div>

      <aside className="compose-side-column"><section className="panel schedule-panel"><div className="section-heading"><span className="section-number">03</span><div><p className="eyebrow">DELIVERY PLAN</p><h3>Set your cadence.</h3></div></div>
          <label className="field"><span>START TIME</span><div className="input-with-icon"><Icon name="calendar" size={16}/><input type="datetime-local" value={startAt} min={localDateTime(new Date())} onChange={(event) => { changed(); setStartAt(event.target.value); }}/></div><small className="field-hint">Shown in your local time zone</small></label>
          <label className="field"><span>DELAY BETWEEN EMAILS</span><div className="number-control"><input type="number" min={Math.ceil(limits.minimumDelayMs / 1000)} max="86400" step="1" value={delaySeconds} onChange={(event) => { changed(); setDelaySeconds(Number(event.target.value)); }}/><span>seconds</span><Icon name="clock" size={16}/></div><small className="field-hint">Minimum {Math.ceil(limits.minimumDelayMs / 1000)} seconds, enforced by the worker.</small></label>
          <label className="field"><span>HOURLY LIMIT</span><div className="number-control"><input type="number" min="1" max={limits.maximumEmailsPerHourPerSender} step="1" value={hourlyLimit} onChange={(event) => { changed(); setHourlyLimit(Number(event.target.value)); }}/><span>emails / hour</span></div><small className="field-hint">Workspace ceiling: {limits.maximumEmailsPerHourPerSender} per sender.</small></label>
          <div className="schedule-note"><span className="schedule-note-icon">✳</span><p>Your {leads?.emails.length ?? 0} recipients will be spaced across at least <strong>{delaySeconds || 0}s</strong> intervals. The shared sender quota is enforced across workers.</p></div>
          <Button type="submit" className="schedule-submit" disabled={saving || !senders.length}>{saving ? <><span className="button-spinner"/> Scheduling…</> : <>Schedule campaign <Icon name="arrow" size={17}/></>}</Button>
          <p className="privacy-note">Each recipient becomes a durable queued email. You can track delivery from Scheduled.</p>
        </section>
      </aside>
    </form>
  </div>;
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
