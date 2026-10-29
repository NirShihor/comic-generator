import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

// ---------------------------------------------------------------------------
// Story workshop: Concept → Story development → (later stages).
// All state lives on the server; the page re-renders from the Story document
// returned by every call. Nothing the AI proposes is applied until the author
// accepts it here.
// ---------------------------------------------------------------------------

const STAGES = [
  { key: 'concept', label: 'Concept' },
  { key: 'development', label: 'Story development' },
  { key: 'script', label: 'English script', soon: 'stage 3' },
  { key: 'review', label: 'Editorial review', soon: 'stage 4' },
  { key: 'adaptation', label: 'Spanish adaptation', soon: 'stage 5' },
  { key: 'spanishReview', label: 'Spanish review', soon: 'stage 6' },
  { key: 'artwork', label: 'Artwork', soon: 'stage 7' }
];

const CATEGORIES = ['character', 'relationship', 'location', 'timeline', 'fact', 'motivation', 'object', 'mystery', 'revelation', 'arc', 'theme', 'other'];
const CATEGORY_LABEL = {
  character: 'Characters', relationship: 'Relationships', location: 'Locations', timeline: 'Timeline', fact: 'Established facts',
  motivation: 'Motivations', object: 'Objects & clues', mystery: 'Unresolved mysteries', revelation: 'Planned revelations', arc: 'Story arc', theme: 'Themes', other: 'Other'
};

const QUICK = [
  'Make the opening more mysterious.',
  'The protagonist is too passive.',
  'Introduce the main threat earlier.',
  'Suggest three different endings.',
  'Make this character more sympathetic.',
  'What is the weakest part of this story right now?'
];

const C = {
  bg: '#1a1a2e', panel: '#16213e', inner: '#0f0f23', border: '#0f3460', text: '#eaeaea', muted: '#9aa3b2',
  accent: '#e94560', ok: '#27ae60', warn: '#f39c12', danger: '#e74c3c', user: '#16213e', assistant: '#1e3a5f'
};

const panelStyle = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.9rem', color: C.text };
const smallBtn = { padding: '0.2rem 0.55rem', fontSize: '0.75rem' };
const inputStyle = { width: '100%', background: C.inner, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.45rem 0.6rem', fontSize: '0.9rem' };

// Minimal markdown: headings, bullets, numbered lists, bold, paragraphs.
function Markdown({ text }) {
  const lines = (text || '').split('\n');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(<ul key={out.length} style={{ margin: '0.3rem 0 0.5rem 1.1rem', padding: 0 }}>{list}</ul>); list = null; } };
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list = list || []; list.push(<li key={i} style={{ marginBottom: '0.2rem' }}>{inline(m[1])}</li>); return; }
    flush();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(<div key={i} style={{ fontWeight: 700, marginTop: '0.6rem', marginBottom: '0.2rem', fontSize: h[1].length <= 2 ? '1rem' : '0.92rem' }}>{inline(h[2])}</div>); return; }
    if (!line.trim()) return;
    out.push(<p key={i} style={{ margin: '0.3rem 0' }}>{inline(line)}</p>);
  });
  flush();
  return <div>{out}</div>;
}

function StatusChip({ status }) {
  const color = { approved: C.ok, proposed: C.warn, rejected: C.danger, superseded: C.muted, pending: C.warn, accepted: C.ok }[status] || C.muted;
  return <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color, border: `1px solid ${color}`, borderRadius: 10, padding: '0 0.4rem', marginLeft: '0.4rem', whiteSpace: 'nowrap' }}>{status}</span>;
}

// --------------------------------------------------------------------------
export default function StoryWorkshop() {
  const { id } = useParams();
  const [story, setStory] = useState(null);
  const [models, setModels] = useState(null);
  const [view, setView] = useState('concept');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/stories/${id}`);
      setStory(r.data);
      setView(v => (v === 'concept' && r.data.stage !== 'concept') ? r.data.stage : v);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }, [id]);

  useEffect(() => { load(); api.get('/stories/models').then(r => setModels(r.data)).catch(() => {}); }, [load]);

  if (error && !story) return <div style={{ color: C.danger }}>{error}</div>;
  if (!story) return <div style={{ color: C.muted }}>Loading…</div>;

  const current = STAGES.find(s => s.key === view) || STAGES[0];

  return (
    <div style={{ background: C.bg, color: C.text, margin: '-0.5rem', padding: '1rem 1.25rem', minHeight: 'calc(100vh - 60px)', width: 'calc(100% + 1rem)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
        <Link to="/stories" style={{ color: C.muted, textDecoration: 'none' }}>← Stories</Link>
        <TitleEditor story={story} onSaved={setStory} />
        <span style={{ color: C.muted, fontSize: '0.8rem' }}>{story.kind === 'standalone' ? 'standalone comic' : 'collection'}{story.concept?.cefr ? ` · ${story.concept.cefr}` : ''}</span>
        <span style={{ flex: 1 }} />
        {models && <span style={{ color: C.muted, fontSize: '0.75rem' }}>writer {story.models?.writer || models.writer} · critic {story.models?.critic || models.critic}</span>}
      </div>

      <StageBar story={story} view={view} setView={setView} />

      {error && <div style={{ color: C.danger, margin: '0.5rem 0' }}>{error} <button className="btn btn-secondary" style={smallBtn} onClick={() => setError('')}>dismiss</button></div>}

      {view === 'concept' && <ConceptStage story={story} setStory={setStory} setError={setError} goDevelop={() => setView('development')} />}
      {view === 'development' && <DevelopmentStage story={story} setStory={setStory} setError={setError} />}
      {current.soon && (
        <div style={{ ...panelStyle, marginTop: '1rem', color: C.muted }}>
          <strong style={{ color: C.text }}>{current.label}</strong> arrives in {current.soon} of the workshop. Approve the story foundation in Story development first.
        </div>
      )}
    </div>
  );
}

function TitleEditor({ story, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(story.title);
  useEffect(() => setValue(story.title), [story.title]);
  const save = async () => {
    setEditing(false);
    if (value.trim() && value !== story.title) {
      const r = await api.patch(`/stories/${story.id}`, { title: value.trim() });
      onSaved(r.data);
    }
  };
  return editing
    ? <input autoFocus value={value} onChange={e => setValue(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(story.title); setEditing(false); } }} style={{ ...inputStyle, width: 320, fontSize: '1.2rem', fontWeight: 700 }} />
    : <h1 style={{ margin: 0, fontSize: '1.4rem', cursor: 'text' }} title="Click to rename" onClick={() => setEditing(true)}>{story.title}</h1>;
}

function StageBar({ story, view, setView }) {
  const approved = story.approvals || {};
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
      {STAGES.map((s, i) => {
        const active = s.key === view;
        const done = s.key === 'concept' ? story.stage !== 'concept' : !!approved[s.key];
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`} style={{ opacity: s.soon ? 0.55 : 1, padding: '0.35rem 0.7rem', fontSize: '0.85rem' }} onClick={() => setView(s.key)}>
              {done ? '✓ ' : ''}{s.label}
            </button>
            {i < STAGES.length - 1 && <span style={{ color: C.muted }}>→</span>}
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------
// Concept intake. Autosaves 700 ms after the last keystroke.
function ConceptStage({ story, setStory, setError, goDevelop }) {
  const [c, setC] = useState(() => normaliseConcept(story.concept));
  const [saveState, setSaveState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(c);
  latest.current = c;

  const scheduleSave = (next) => {
    setC(next);
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const r = await api.put(`/stories/${story.id}/concept`, { concept: latest.current });
        setStory(r.data);
        setSaveState('saved');
      } catch (e) { setSaveState('error'); setError(e.response?.data?.error || e.message); }
    }, 700);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const flushNow = async () => {
    clearTimeout(timer.current);
    const r = await api.put(`/stories/${story.id}/concept`, { concept: latest.current });
    setStory(r.data);
    setSaveState('saved');
    return r.data;
  };

  const field = (key, label, props = {}) => (
    <div className="form-group" style={{ marginBottom: '0.7rem' }}>
      <label style={{ color: C.muted, fontSize: '0.8rem' }}>{label}</label>
      {props.multiline
        ? <textarea rows={props.rows || 3} value={c[key] || ''} onChange={e => scheduleSave({ ...c, [key]: e.target.value })} placeholder={props.placeholder} style={{ ...inputStyle, resize: 'vertical' }} />
        : <input value={c[key] ?? ''} onChange={e => scheduleSave({ ...c, [key]: e.target.value })} placeholder={props.placeholder} style={inputStyle} />}
    </div>
  );

  const setChar = (i, key, value) => scheduleSave({ ...c, characters: c.characters.map((ch, j) => j === i ? { ...ch, [key]: value } : ch) });
  const started = (story.threads || []).some(t => t.stage === 'development' && t.messages?.length);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ margin: '0 0 0.6rem' }}>The concept</h3>
          <span style={{ color: saveState === 'error' ? C.danger : C.muted, fontSize: '0.75rem' }}>{{ saved: 'saved', dirty: 'unsaved…', saving: 'saving…', error: 'save failed' }[saveState]}</span>
        </div>
        <p style={{ color: C.muted, fontSize: '0.85rem', marginTop: 0 }}>Nothing is mandatory. A premise alone is enough to start; the co-writer will ask for the rest.</p>
        {field('premise', 'Premise / basic idea', { multiline: true, rows: 5, placeholder: 'A Western set in New Mexico in 1885. A mysterious stranger arrives in a small town where someone is leaving black playing cards as warnings…' })}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.8rem' }}>
          {field('genre', 'Genre', { placeholder: 'Western mystery' })}
          {field('tone', 'Tone', { placeholder: 'tense, dry humour, grounded' })}
          {field('setting', 'Setting (place)', { placeholder: 'Santa Roja, New Mexico Territory' })}
          {field('period', 'Period', { placeholder: '1885' })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 0.8rem' }}>
          <div className="form-group" style={{ marginBottom: '0.7rem' }}>
            <label style={{ color: C.muted, fontSize: '0.8rem' }}>Comics in the collection</label>
            <input type="number" min={1} max={12} value={c.comicCount ?? ''} onChange={e => scheduleSave({ ...c, comicCount: e.target.value })} placeholder="3" style={inputStyle} />
          </div>
          <div className="form-group" style={{ marginBottom: '0.7rem' }}>
            <label style={{ color: C.muted, fontSize: '0.8rem' }}>Story pages per comic</label>
            <input type="number" min={4} max={40} value={c.pagesPerComic ?? ''} onChange={e => scheduleSave({ ...c, pagesPerComic: e.target.value })} placeholder="14" style={inputStyle} />
          </div>
          <div className="form-group" style={{ marginBottom: '0.7rem' }}>
            <label style={{ color: C.muted, fontSize: '0.8rem' }}>Target Spanish level</label>
            <select value={c.cefr || 'A1'} onChange={e => scheduleSave({ ...c, cefr: e.target.value })} style={inputStyle}>
              {['A1', 'A2', 'B1', 'B2'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        {field('notes', 'Anything else (influences, things to avoid, what you want readers to feel)', { multiline: true, rows: 3 })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={{ margin: '0 0 0.6rem' }}>Characters you already have in mind</h3>
            <button className="btn btn-secondary" style={smallBtn} onClick={() => scheduleSave({ ...c, characters: [...c.characters, { id: `char-${Date.now()}`, name: '', age: '', personality: '', relationships: '', notes: '' }] })}>+ Character</button>
          </div>
          {c.characters.length === 0 && <p style={{ color: C.muted, fontSize: '0.85rem' }}>Optional. Leave empty and let the co-writer propose a cast.</p>}
          {c.characters.map((ch, i) => (
            <div key={ch.id} style={{ background: C.inner, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.6rem', marginBottom: '0.6rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <input value={ch.name} onChange={e => setChar(i, 'name', e.target.value)} placeholder="Name" style={inputStyle} />
                <input value={ch.age} onChange={e => setChar(i, 'age', e.target.value)} placeholder="Age" style={inputStyle} />
                <button className="btn btn-secondary" style={smallBtn} onClick={() => scheduleSave({ ...c, characters: c.characters.filter((_, j) => j !== i) })}>✕</button>
              </div>
              <textarea rows={2} value={ch.personality} onChange={e => setChar(i, 'personality', e.target.value)} placeholder="Personality, what drives them" style={{ ...inputStyle, marginBottom: '0.4rem' }} />
              <textarea rows={2} value={ch.relationships} onChange={e => setChar(i, 'relationships', e.target.value)} placeholder="Relationships to the others (if known)" style={inputStyle} />
            </div>
          ))}
        </div>

        <div style={panelStyle}>
          <h3 style={{ margin: '0 0 0.4rem' }}>Next</h3>
          <p style={{ color: C.muted, fontSize: '0.85rem', marginTop: 0 }}>
            {started
              ? 'Development has started. Changes to the concept are saved and the co-writer sees them on its next turn.'
              : 'When the concept says enough, start development. The co-writer opens with an honest assessment, first bible proposals and the questions that matter most.'}
          </p>
          <button className="btn btn-primary" disabled={saveState === 'saving'} onClick={async () => { await flushNow(); goDevelop(); }}>
            {started ? 'Go to story development →' : 'Start story development →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function normaliseConcept(c = {}) {
  return {
    characters: (c.characters || []).map(ch => ({ id: ch.id || `char-${Math.random().toString(36).slice(2, 8)}`, name: ch.name || '', age: ch.age || '', personality: ch.personality || '', relationships: ch.relationships || '', notes: ch.notes || '' })),
    setting: c.setting || '', period: c.period || '', genre: c.genre || '', premise: c.premise || '', tone: c.tone || '', notes: c.notes || '',
    comicCount: c.comicCount ?? '', pagesPerComic: c.pagesPerComic ?? '', cefr: c.cefr || 'A1'
  };
}

// --------------------------------------------------------------------------
function DevelopmentStage({ story, setStory, setError }) {
  const thread = useMemo(() => (story.threads || []).find(t => t.stage === 'development' && t.episodeIndex == null) || { messages: [] }, [story]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const startedRef = useRef(false);

  const send = useCallback(async (content) => {
    setBusy(true);
    try {
      const r = await api.post(`/stories/${story.id}/threads/development/messages`, { content });
      setStory(r.data);
    } catch (e) {
      if (e.response?.data?.story) setStory(e.response.data.story);
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  }, [story.id, setStory, setError]);

  // First visit with an empty thread: the co-writer opens the conversation.
  useEffect(() => {
    if (!thread.messages.length && !busy && !startedRef.current) { startedRef.current = true; send(''); }
  }, [thread.messages.length, busy, send]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.messages.length]);

  const verdict = async (proposalId, v) => {
    try { const r = await api.post(`/stories/${story.id}/proposals/${proposalId}/${v}`); setStory(r.data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  };
  const acceptAll = async (messageId) => {
    try {
      const r = await api.post(`/stories/${story.id}/messages/${messageId}/accept-all`);
      setStory(r.data.story);
      if (r.data.failures?.length) setError(`${r.data.failures.length} proposal(s) could not be applied: ${r.data.failures.map(f => f.error).join('; ')}`);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };
  const retry = async (messageId) => {
    const failed = thread.messages.find(m => m.id === messageId);
    const idx = thread.messages.indexOf(failed);
    const prev = idx > 0 ? thread.messages[idx - 1] : null;
    try {
      const r = await api.delete(`/stories/${story.id}/threads/development/messages/${messageId}`);
      setStory(r.data);
      if (prev?.role === 'user') await send(prev.content);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    send(text);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 5fr) minmax(420px, 6fr)', gap: '1rem', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <BiblePanel story={story} setStory={setStory} setError={setError} />
        <DecisionsPanel story={story} setStory={setStory} setError={setError} />
        <ApprovalPanel story={story} setStory={setStory} setError={setError} />
      </div>

      <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', position: 'sticky', top: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Co-writer</h3>
          <span style={{ color: C.muted, fontSize: '0.75rem' }}>It proposes; you decide. Accept or reject each proposal.</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: C.inner, borderRadius: 6, padding: '0.6rem', border: `1px solid ${C.border}` }}>
          {thread.messages.map(m => <Message key={m.id} m={m} onVerdict={verdict} onAcceptAll={acceptAll} onRetry={retry} busy={busy} />)}
          {busy && <div style={{ color: C.muted, fontStyle: 'italic', padding: '0.4rem' }}>Thinking…</div>}
          <div ref={endRef} />
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', margin: '0.5rem 0' }}>
          {QUICK.map(q => <button key={q} className="btn btn-secondary" style={{ ...smallBtn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => send(q)}>{q}</button>)}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <textarea rows={3} value={input} onChange={e => setInput(e.target.value)} disabled={busy}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Discuss, push back, ask for alternatives… (Enter to send, Shift+Enter for a new line)" style={{ ...inputStyle, resize: 'vertical' }} />
          <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={submit}>Send</button>
        </div>
      </div>
    </div>
  );
}

function Message({ m, onVerdict, onAcceptAll, onRetry, busy }) {
  const isUser = m.role === 'user';
  const pending = (m.proposals || []).filter(p => p.status === 'pending');
  return (
    <div style={{ background: isUser ? C.user : C.assistant, borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: '0.9rem', lineHeight: 1.45 }}>
      <div style={{ color: C.muted, fontSize: '0.7rem', marginBottom: '0.25rem' }}>{isUser ? 'You' : 'Co-writer'}{m.model ? ` · ${m.model}` : ''}{m.usage?.input ? ` · ${m.usage.input}+${m.usage.output} tokens` : ''}</div>
      {m.error ? (
        <div style={{ color: C.danger }}>The co-writer's reply failed: {m.error}
          <div><button className="btn btn-secondary" style={{ ...smallBtn, marginTop: '0.3rem' }} disabled={busy} onClick={() => onRetry(m.id)}>Try again</button></div>
        </div>
      ) : <Markdown text={m.content} />}

      {m.challenges?.length > 0 && (
        <div style={{ borderLeft: `3px solid ${C.accent}`, paddingLeft: '0.6rem', margin: '0.5rem 0' }}>
          <div style={{ fontWeight: 700, color: C.accent, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pushback</div>
          {m.challenges.map((ch, i) => (
            <div key={i} style={{ margin: '0.3rem 0' }}>
              <strong>{ch.about}.</strong> {ch.problem} <span style={{ color: C.muted }}>Fix:</span> {ch.suggestion}
            </div>
          ))}
        </div>
      )}
      {m.questions?.length > 0 && (
        <div style={{ margin: '0.5rem 0' }}>
          <div style={{ fontWeight: 700, color: C.muted, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Questions for you</div>
          <ol style={{ margin: '0.2rem 0 0 1.2rem', padding: 0 }}>{m.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </div>
      )}
      {m.proposals?.length > 0 && (
        <div style={{ margin: '0.5rem 0 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontWeight: 700, color: C.muted, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Proposals ({m.proposals.length})</div>
            {pending.length > 1 && <button className="btn btn-secondary" style={smallBtn} disabled={busy} onClick={() => onAcceptAll(m.id)}>Accept all {pending.length}</button>}
          </div>
          {m.proposals.map(p => <Proposal key={p.id} p={p} onVerdict={onVerdict} busy={busy} />)}
        </div>
      )}
    </div>
  );
}

function Proposal({ p, onVerdict, busy }) {
  const label = p.kind === 'decision' ? 'Decision' : CATEGORY_LABEL[p.category] || 'Bible';
  const action = p.action === 'add' ? '' : ` (${p.action}${p.targetId ? ` ${p.targetId}` : ''})`;
  return (
    <div style={{ background: C.inner, border: `1px solid ${p.status === 'pending' ? C.warn : C.border}`, borderRadius: 6, padding: '0.5rem 0.6rem', margin: '0.35rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}{action}</span>
        {p.name && <strong>{p.name}</strong>}
        <StatusChip status={p.status} />
      </div>
      <div style={{ margin: '0.25rem 0' }}>{p.text}</div>
      {p.rationale && <div style={{ color: C.muted, fontSize: '0.8rem' }}>Why: {p.rationale}</div>}
      {p.status === 'pending' && (
        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
          <button className="btn btn-primary" style={smallBtn} disabled={busy} onClick={() => onVerdict(p.id, 'accept')}>Accept</button>
          <button className="btn btn-secondary" style={smallBtn} disabled={busy} onClick={() => onVerdict(p.id, 'reject')}>Reject</button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
function BiblePanel({ story, setStory, setError }) {
  const [showRejected, setShowRejected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ category: 'character', name: '', text: '' });
  const entries = story.bible || [];
  const visible = entries.filter(e => showRejected || e.status !== 'rejected');
  const approved = entries.filter(e => e.status === 'approved').length;
  const rejected = entries.filter(e => e.status === 'rejected').length;

  const call = async (fn) => { try { const r = await fn(); setStory(r.data); } catch (e) { setError(e.response?.data?.error || e.message); } };
  const add = () => call(async () => { const r = await api.post(`/stories/${story.id}/bible`, draft); setAdding(false); setDraft({ category: 'character', name: '', text: '' }); return r; });

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
        <h3 style={{ margin: 0 }}>Story Bible <span style={{ color: C.muted, fontSize: '0.8rem', fontWeight: 400 }}>{approved} approved</span></h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {rejected > 0 && <button className="btn btn-secondary" style={smallBtn} onClick={() => setShowRejected(s => !s)}>{showRejected ? 'Hide' : 'Show'} rejected ({rejected})</button>}
          <button className="btn btn-secondary" style={smallBtn} onClick={() => setAdding(a => !a)}>+ Entry</button>
        </div>
      </div>
      {adding && (
        <div style={{ background: C.inner, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.5rem', marginBottom: '0.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.4rem', marginBottom: '0.4rem' }}>
            <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} style={inputStyle}>{CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name / label" style={inputStyle} />
          </div>
          <textarea rows={3} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="The entry" style={inputStyle} />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
            <button className="btn btn-primary" style={smallBtn} disabled={!draft.text.trim()} onClick={add}>Add as approved</button>
            <button className="btn btn-secondary" style={smallBtn} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {visible.length === 0 && <p style={{ color: C.muted, fontSize: '0.85rem', margin: 0 }}>Empty. Accept the co-writer's proposals or add entries yourself.</p>}
      {CATEGORIES.filter(cat => visible.some(e => e.category === cat)).map(cat => (
        <div key={cat} style={{ marginBottom: '0.6rem' }}>
          <div style={{ color: C.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{CATEGORY_LABEL[cat]}</div>
          {visible.filter(e => e.category === cat).map(e => (
            <EditableRow key={e.id} item={e} label={e.name} text={e.text} status={e.status} source={e.source}
              onSave={(patch) => call(() => api.put(`/stories/${story.id}/bible/${e.id}`, patch))}
              onDelete={() => { if (window.confirm('Delete this entry?')) call(() => api.delete(`/stories/${story.id}/bible/${e.id}`)); }}
              nameEditable />
          ))}
        </div>
      ))}
    </div>
  );
}

function DecisionsPanel({ story, setStory, setError }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [showOld, setShowOld] = useState(false);
  const decisions = story.decisions || [];
  const live = decisions.filter(d => d.status === 'approved' || d.status === 'proposed');
  const old = decisions.filter(d => d.status === 'rejected' || d.status === 'superseded');
  const call = async (fn) => { try { const r = await fn(); setStory(r.data); } catch (e) { setError(e.response?.data?.error || e.message); } };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
        <h3 style={{ margin: 0 }}>Decisions <span style={{ color: C.muted, fontSize: '0.8rem', fontWeight: 400 }}>{live.filter(d => d.status === 'approved').length} approved</span></h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {old.length > 0 && <button className="btn btn-secondary" style={smallBtn} onClick={() => setShowOld(s => !s)}>{showOld ? 'Hide' : 'Show'} old ({old.length})</button>}
          <button className="btn btn-secondary" style={smallBtn} onClick={() => setAdding(a => !a)}>+ Decision</button>
        </div>
      </div>
      <p style={{ color: C.muted, fontSize: '0.8rem', marginTop: 0 }}>Plot-level choices in one sentence each. Approved decisions bind every later AI turn.</p>
      {adding && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="e.g. The stranger is the sheriff's brother." style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { call(() => api.post(`/stories/${story.id}/decisions`, { text })); setText(''); setAdding(false); } }} />
          <button className="btn btn-primary" style={smallBtn} disabled={!text.trim()} onClick={() => { call(() => api.post(`/stories/${story.id}/decisions`, { text })); setText(''); setAdding(false); }}>Add</button>
        </div>
      )}
      {live.length === 0 && <p style={{ color: C.muted, fontSize: '0.85rem', margin: 0 }}>None yet.</p>}
      {[...live, ...(showOld ? old : [])].map(d => (
        <EditableRow key={d.id} item={d} text={d.text} status={d.status} source={d.source} sub={d.rationale}
          onSave={(patch) => call(() => api.put(`/stories/${story.id}/decisions/${d.id}`, patch))}
          onDelete={() => { if (window.confirm('Delete this decision?')) call(() => api.delete(`/stories/${story.id}/decisions/${d.id}`)); }} />
      ))}
    </div>
  );
}

// A bible entry or decision: click the text to edit; approve / reject / delete.
function EditableRow({ item, label, text, status, source, sub, onSave, onDelete, nameEditable }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(text);
  const [draftName, setDraftName] = useState(label || '');
  useEffect(() => { setDraftText(text); setDraftName(label || ''); }, [text, label]);
  const dim = status === 'rejected' || status === 'superseded';
  const save = () => { setEditing(false); const patch = {}; if (draftText.trim() && draftText !== text) patch.text = draftText.trim(); if (nameEditable && draftName !== (label || '')) patch.name = draftName.trim(); if (Object.keys(patch).length) onSave(patch); };
  return (
    <div style={{ background: C.inner, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.45rem 0.55rem', marginBottom: '0.35rem', opacity: dim ? 0.55 : 1 }}>
      {editing ? (
        <div>
          {nameEditable && <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Name / label" style={{ ...inputStyle, marginBottom: '0.3rem' }} />}
          <textarea autoFocus rows={3} value={draftText} onChange={e => setDraftText(e.target.value)} style={inputStyle}
            onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setDraftText(text); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
            <button className="btn btn-primary" style={smallBtn} onClick={save}>Save</button>
            <button className="btn btn-secondary" style={smallBtn} onClick={() => { setEditing(false); setDraftText(text); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, cursor: 'text' }} onClick={() => setEditing(true)} title="Click to edit">
            {label && <strong>{label}: </strong>}<span style={{ fontSize: '0.9rem' }}>{text}</span>
            {sub && <div style={{ color: C.muted, fontSize: '0.78rem' }}>{sub}</div>}
            <span style={{ fontSize: '0.7rem', color: C.muted, marginLeft: '0.3rem' }}>{source === 'ai' ? 'from co-writer' : 'yours'}</span>
            <StatusChip status={status} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {status === 'proposed' && <button className="btn btn-primary" style={smallBtn} onClick={() => onSave({ status: 'approved' })}>Approve</button>}
            {status === 'approved' && <button className="btn btn-secondary" style={smallBtn} onClick={() => onSave({ status: 'rejected' })} title="Retire this entry; the co-writer is told not to propose it again">Retire</button>}
            {(status === 'rejected' || status === 'superseded') && <button className="btn btn-secondary" style={smallBtn} onClick={() => onSave({ status: 'approved' })}>Restore</button>}
            <button className="btn btn-secondary" style={{ ...smallBtn, color: C.danger }} onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalPanel({ story, setStory, setError }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const versions = (story.versions || []).filter(v => v.stage === 'development');
  const approvedAt = story.approvals?.development;
  const pendingCount = (story.threads || []).reduce((n, t) => n + (t.messages || []).reduce((k, m) => k + (m.proposals || []).filter(p => p.status === 'pending').length, 0), 0);
  const approve = async () => {
    setBusy(true);
    try { const r = await api.post(`/stories/${story.id}/approve`, { stage: 'development', note }); setStory(r.data); setNote(''); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Approve the story foundation</h3>
      <p style={{ color: C.muted, fontSize: '0.8rem', marginTop: 0 }}>
        Snapshots the concept, the approved bible and the approved decisions as a version. You can keep developing afterwards and approve again.
        {pendingCount > 0 && <span style={{ color: C.warn }}> {pendingCount} proposal{pendingCount === 1 ? '' : 's'} still awaiting your verdict.</span>}
      </p>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for this version (optional)" style={inputStyle} />
        <button className="btn btn-primary" disabled={busy} onClick={approve}>{approvedAt ? 'Approve again' : 'Approve'}</button>
      </div>
      {versions.length > 0 && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: C.muted }}>
          {versions.slice().reverse().map(v => (
            <div key={v.id}>✓ {new Date(v.createdAt).toLocaleString()} — {v.snapshot?.bible?.length || 0} bible entries, {v.snapshot?.decisions?.length || 0} decisions{v.note ? ` — ${v.note}` : ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}
