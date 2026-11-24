'use client';
import { useEffect, useRef, useState } from 'react';
import { crmConfirmationError, crmFetch } from '@/lib/crm';
import { foldDictationEvent, stabiliseLiveDictationPreview } from '@/lib/dictation';
import type { LeadFormState } from '@/lib/lead-workspace';
import { leadButton } from '@/components/crm/AssignedLeadDetails';

export default function LeadNoteForm({ companyId, channel, onSaved, onStateChange, onCheckHistory }: {
  companyId: string; channel: 'note' | 'phone'; onSaved: () => void;
  onStateChange: (state: LeadFormState) => void; onCheckHistory: () => void;
}) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [listening, setListening] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [uncertain, setUncertain] = useState(false);
  const recognitionRef = useRef<any>(null), textAreaRef = useRef<HTMLTextAreaElement>(null), requestRef = useRef('');
  const savingRef = useRef(false);
  useEffect(() => { onStateChange({ dirty: !!text.trim(), busy, listening }); }, [text, busy, listening, onStateChange]);
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null; recognition.onend = null; recognition.onerror = null;
      try { recognition.abort(); } catch { /* The browser may already have ended recognition. */ }
    }
  }, []);
  useEffect(() => { if (listening && textAreaRef.current) textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight; }, [text, listening]);

  function stopVoice() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    // Keep the displayed interim words, but ignore late events after saving.
    if (recognition) {
      recognition.onresult = null; recognition.onend = null; recognition.onerror = null;
      try { recognition.stop(); } catch { /* Preserve displayed text if recognition already stopped. */ }
    }
    setListening(false);
  }
  function toggleVoice() {
    if (listening) { stopVoice(); return; }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('This browser does not support dictation. Type your note or use Chrome or Edge.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-GB'; recognition.interimResults = true; recognition.continuous = true;
    const base = text.trim() ? `${text.trim()} ` : '';
    let committed = '', preview = text;
    recognition.onresult = (event: any) => {
      if (recognitionRef.current !== recognition) return;
      const folded = foldDictationEvent(committed, event.results); committed = folded.committed;
      const final = Array.from(event.results as ArrayLike<any>).some(result => result.isFinal);
      preview = stabiliseLiveDictationPreview(preview, `${base}${folded.text}`, final).slice(0, 4000);
      setText(preview);
    };
    recognition.onend = () => { if (recognitionRef.current === recognition) { recognitionRef.current = null; setListening(false); } };
    recognition.onerror = () => { if (recognitionRef.current === recognition) { setError('Dictation stopped. Your words are still here. You can type or start the microphone again.'); stopVoice(); } };
    recognitionRef.current = recognition; setError(''); setListening(true);
    try { recognition.start(); } catch { stopVoice(); setError('The microphone could not start. Allow microphone access or type your note.'); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || !text.trim()) return;
    stopVoice(); savingRef.current = true; setBusy(true); setError(''); setNotice('');
    if (!requestRef.current) requestRef.current = crypto.randomUUID();
    const url = `/api/crm/companies/${companyId}/activity`;
    try {
      const result = await crmFetch<{ item?: { id: string; company_id: string; content: string } }>(url, {
        method: 'POST', body: JSON.stringify({ channel, content: text.trim(), analyse: false, requestId: requestRef.current }),
      });
      if (result.item?.id !== requestRef.current || result.item.company_id !== companyId || result.item.content !== text.trim()) throw crmConfirmationError({ url, reason: 'The server did not confirm this exact note' });
      setText(''); requestRef.current = ''; setUncertain(false);
      setNotice(channel === 'phone' ? 'Call logged. No email drafted and no deal stage changed.' : 'Note saved. No email drafted and no deal stage changed.');
      onSaved();
    } catch (caught: any) {
      setUncertain(!caught?.status || caught.status >= 500 || caught.status === 408 || caught.status === 409);
      setError(caught?.message || 'The save was not confirmed. Check recent notes before retrying this unchanged form.');
    } finally { savingRef.current = false; setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-3" aria-label={channel === 'phone' ? 'Log a phone call' : 'Add a note'}>
    <label className="block text-sm font-medium">{channel === 'phone' ? 'What happened on the call?' : 'What should we remember?'}
      <textarea ref={textAreaRef} rows={4} maxLength={4000} value={text} disabled={busy || uncertain || listening} onChange={event => { setText(event.target.value); setNotice(''); }} placeholder="Type your update, or use Speak…" className="mt-2 min-h-28 w-full resize-y rounded-lg border border-edge bg-ink p-3 text-base leading-relaxed focus:border-amber disabled:opacity-80" />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`${leadButton} ${listening ? 'text-rust border-rust' : ''}`} onClick={toggleVoice} disabled={busy || uncertain} aria-pressed={listening}>{listening ? 'Stop dictation' : 'Speak note'}</button>
      <button className={`${leadButton} ml-auto border-amber/50 bg-amber/10 text-amber`} disabled={busy || !text.trim()}>{busy ? 'Saving…' : uncertain ? 'Retry unchanged note' : channel === 'phone' ? 'Save call log' : 'Save note'}</button>
    </div>
    <p className="text-xs leading-relaxed text-muted">{listening ? 'Listening. Your words stay visible. Stop to edit.' : 'Saved to this company with a timestamp, using your account. This does not send a message or generate suggestions.'}</p>
    {error && <div role="alert" className="text-sm text-rust"><p>{error}</p>{uncertain && <button className={`${leadButton} mt-2`} type="button" onClick={onCheckHistory}>Check recent notes</button>}</div>}
    {notice && <p role="status" className="text-sm text-sage">{notice}</p>}
  </form>;
}
