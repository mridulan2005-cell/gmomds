import { useCallback, useEffect, useRef, useState } from 'react';
import type { Go } from '../App';
import { Arrow } from '../components';
import { DADI, CHILD, INK, LOVE_ICON, TILES } from '../lib/content';
import { finishOnboarding, getState } from '../lib/store';
import type { PersonId } from '../lib/types';

const ROLES = ['Grandmother', 'Grandfather', 'Mom', 'Dad'];
type Tool = 'pen' | 'eraser';

// Seven steps, the grandchild first: their name, what they love, who they are playing with;
// then the grown-up's name and loves; then they draw each other. The caricatures walk around the maps from then on.
export function Onboarding({ go }: { go: Go }) {
  const init = getState();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<{ dadi: string[]; child: string[] }>(() => { const ok = (l: string[]) => l.filter(k => LOVE_ICON[k]); return { dadi: ok(init.loves.dadi), child: ok(init.loves.child) }; });
  // a first run starts with empty names; running it again keeps the ones they gave
  const [names, setNames] = useState(init.onboarded ? init.names : { dadi: '', child: '' });
  const [role, setRole] = useState(init.role || 'Grandmother');
  const [faces, setFaces] = useState(init.faces);
  const childName = names.child.trim() || 'Aarav', elderName = names.dadi.trim() || role;
  const askName = step === 0 || step === 3, picking = step === 1 || step === 4, drawing = step === 5 || step === 6;
  const who: PersonId = step <= 2 || step === 6 ? 'child' : 'dadi', color = who === 'dadi' ? DADI : CHILD, mine = picks[who];
  const toggle = (k: string) => setPicks(p => ({ ...p, [who]: p[who].includes(k) ? p[who].filter(x => x !== k) : [...p[who], k] }));

  const pad = useRef<PadApi>({ save: () => null, clear: () => {} });
  const [padBlank, setPadBlank] = useState(true);
  const mic = useMic(t => setNames(n => ({ ...n, [step === 0 ? 'child' : 'dadi']: t })));

  const ok = drawing ? !padBlank : askName ? !!names[step === 0 ? 'child' : 'dadi'].trim() : picking ? mine.length > 0 : true;
  const next = () => {
    if (!ok) return;
    mic.stop();
    if (drawing) {
      const subj: PersonId = step === 5 ? 'child' : 'dadi', url = pad.current.save();
      const out = url ? { ...faces, [subj]: url } : faces;
      setFaces(out);
      if (step === 6) { finishOnboarding({ dadi: elderName, child: childName }, picks, out, role); go({ screen: 'how' }); return; }
    }
    setStep(step + 1); setPadBlank(true);
  };

  const btn = askName ? 'Next' : step === 2 ? "That's who" : picking ? "That's me" : step === 5 ? `That's ${childName}!` : 'Start our map';
  const go1 = <button className="btn-primary" disabled={!ok} onClick={next}><Arrow />{btn}</button>;
  return (
    <div className="screen ob safe-top">
      <div className="ob-sub">Before we begin · {step + 1} of 7</div>
      {askName && (
        <>
          <div className="ob-title">{step === 0 ? <><span style={{ color }}>Hi!</span> What's your name?</> : <><span style={{ color }}>{role}</span>, what's your name?</>}</div>
          <div className="ob-name">
            <input key={step} autoFocus value={names[who]} maxLength={16} placeholder={mic.listening ? 'Listening…' : 'Your name'} style={{ color, borderBottomColor: color }}
              onChange={e => setNames({ ...names, [who]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') next(); }} />
            <button className={'ob-mic' + (mic.listening ? ' on' : '')} aria-label="Say it" onClick={mic.toggle}>
              <svg width="40" height="44" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="14" rx="4" fill="currentColor" /><path d="M4 12 a8 8 0 0 0 16 0" /><path d="M12 20 V24" /></svg>
            </button>
          </div>
          <div className="ob-micnote">{mic.error ? "Couldn't hear that. Try again or type it." : mic.listening ? 'Say your name…' : 'Type it, or tap the mic and say it'}</div>
          <div className="ob-actions">{go1}</div>
        </>
      )}
      {step === 2 && (
        <>
          <div className="ob-title"><span style={{ color: CHILD }}>{childName}</span>, who are you playing with?</div>
          <div className="ob-roles">
            {ROLES.map((r, i) => {
              const sel = role === r;
              return <button key={r} className="tile role" aria-pressed={sel} onClick={() => setRole(r)}
                style={{ background: sel ? 'rgba(47,95,208,.14)' : 'var(--cream)', color: sel ? DADI : INK, rotate: sel ? '-3deg' : i % 2 ? '1deg' : '-1deg', scale: sel ? '1.06' : '1' }}>{r}</button>;
            })}
          </div>
          <div className="ob-actions">{go1}</div>
        </>
      )}
      {picking && (
        <>
          <div className="ob-title"><span style={{ color }}>{who === 'dadi' ? elderName : childName}</span>, what do you love?</div>
          <div className="ob-grid">
            {TILES.map(([label, k]) => {
              const sel = mine.includes(k), ic = LOVE_ICON[k];
              return (
                <button key={k} className="tile" onClick={() => toggle(k)} aria-pressed={sel}
                  style={{ background: sel ? (who === 'dadi' ? 'rgba(47,95,208,.14)' : 'rgba(228,87,46,.14)') : 'transparent', color: sel ? color : INK, rotate: sel ? '-3deg' : '0deg', scale: sel ? '1.05' : '1' }}>
                  <svg viewBox="0 0 64 64" width="80" height="80" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path d={ic.f.join(' ')} fill={sel ? ic.c : 'currentColor'} fillOpacity={sel ? 0.6 : 0.15} stroke="currentColor" strokeWidth="2.8" />
                    <path d={ic.s.join(' ')} stroke="currentColor" strokeWidth="2.8" />
                  </svg>
                  {label}
                  {/* what the grandchild picked, so the grown-up can see */}
                  {who === 'dadi' && picks.child.includes(k) && <div className="dot" />}
                </button>
              );
            })}
          </div>
          <div className="ob-actions">{go1}</div>
        </>
      )}
      {drawing && (
        <DrawFace key={step} by={step === 5 ? elderName : childName} subj={step === 5 ? childName : elderName}
          ink={step === 5 ? DADI : CHILD} subjColor={step === 5 ? CHILD : DADI} tint={step === 5 ? '#EEF2FC' : '#FDF0EA'}
          api={pad} onBlank={setPadBlank} next={<button className="btn-primary ob-draw-next" disabled={!ok} onClick={next}><Arrow />{btn}</button>} />
      )}
    </div>
  );
}

/** Say your name instead of typing it (where the browser can listen). */
function useMic(onText: (t: string) => void) {
  const [listening, setListening] = useState(false), [error, setError] = useState(false), rec = useRef<any>(null), cb = useRef(onText);
  cb.current = onText;
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } rec.current = null; setListening(false); };
  useEffect(() => stop, []);
  const toggle = () => {
    if (listening) { stop(); return; }
    const w = window as any, SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setError(true); return; }
    try {
      const r = new SR(); rec.current = r; r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = (e: any) => {
        const t = String(e.results[0][0].transcript || '').trim().replace(/[.!?]+$/, '').replace(/^(my name is|my name's|i am|i'm|it's|this is)\s+/i, '');
        cb.current(t.split(' ').map(x => (x ? x[0].toUpperCase() + x.slice(1) : x)).join(' ')); setError(false); setListening(false);
      };
      r.onerror = () => { setListening(false); setError(true); };
      r.onend = () => { rec.current = null; setListening(false); };
      r.start(); setListening(true); setError(false);
    } catch { setError(true); setListening(false); }
  };
  return { listening, error, toggle, stop };
}

interface PadApi { save: () => string | null; clear: () => void }

/** A blank paper card to draw the other person on with a finger, with a pencil and an eraser. */
function DrawFace({ by, subj, ink, subjColor, tint, api, onBlank, next }: {
  by: string; subj: string; ink: string; subjColor: string; tint: string;
  api: React.MutableRefObject<PadApi>; onBlank: (b: boolean) => void; next: React.ReactNode;
}) {
  const cv = useRef<HTMLCanvasElement | null>(null), dirty = useRef(false), stroke = useRef(false);
  const [tool, setTool] = useState<Tool>('pen'), toolRef = useRef(tool);
  toolRef.current = tool;
  const ref = useCallback((c: HTMLCanvasElement | null) => {
    cv.current = c; if (!c) return;
    api.current = {
      save: () => (dirty.current && cv.current ? cv.current.toDataURL('image/png') : null),
      clear: () => { c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; },
    };
  }, []);
  const pt = (e: React.PointerEvent) => { const c = cv.current!, r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]; };
  const down = (e: React.PointerEvent) => {
    const c = cv.current; if (!c) return; c.setPointerCapture?.(e.pointerId);
    const x = c.getContext('2d')!, [px, py] = pt(e), er = toolRef.current === 'eraser';
    x.globalCompositeOperation = er ? 'destination-out' : 'source-over';
    x.strokeStyle = ink; x.lineWidth = er ? 56 : 14; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + 0.1, py); x.stroke();
    stroke.current = true;
    if (!er) { dirty.current = true; onBlank(false); }
  };
  const move = (e: React.PointerEvent) => { if (!stroke.current || !cv.current) return; const x = cv.current.getContext('2d')!, [px, py] = pt(e); x.lineTo(px, py); x.stroke(); };
  const up = () => { stroke.current = false; };
  const toolBtn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button className={'ob-tool' + (tool === t ? ' on' : '')} aria-pressed={tool === t} onClick={() => setTool(t)}>{icon}{label}</button>
  );
  return (
    <>
      <div className="ob-title draw"><span style={{ color: ink }}>{by}</span>, draw <span style={{ color: subjColor }}>{subj}</span>!</div>
      <div className="ob-note">Make it silly. Little {subj} will walk around all your maps.</div>
      <div className="ob-draw">
        <div className="ob-tools">
          {toolBtn('pen', 'Pencil', <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z" /><path d="M14 6 L18 10" /></svg>)}
          {toolBtn('eraser', 'Eraser', <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 20 L3 15 L13 5 L20 12 L12 20 Z" /><path d="M8 10 L15 17" /><path d="M12 20 H21" /></svg>)}
          <button className="ob-clear" onClick={() => { api.current.clear(); onBlank(true); setTool('pen'); }}>Start over</button>
        </div>
        <div className="face-card">
          <div className="side l" /><div className="side r" />
          <div className="face-pad" style={{ background: tint }}>
            <canvas ref={ref} width={952} height={952} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }} />
          </div>
          <div className="face-label"><span style={{ color: subjColor }}>{subj}</span><span style={{ opacity: 0.55 }}>by {by}</span></div>
        </div>
        <div className="ob-next">{next}</div>
      </div>
    </>
  );
}
