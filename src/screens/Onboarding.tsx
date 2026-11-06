import { useCallback, useEffect, useRef, useState } from 'react';
import type { Go } from '../App';
import { Arrow } from '../components';
import { EraserIcon, MicIcon, PencilIcon } from '../icons';
import { DADI, CHILD, INK, LOVE_ART, LOVE_ICON, TILES } from '../lib/content';
import { finishOnboarding, getState, update, useApp } from '../lib/store';
import { LANG_OPTIONS, useT } from '../lib/i18n';
import { useSay } from '../lib/voice';
import type { PersonId } from '../lib/types';

const ROLES = ['Grandmother', 'Grandfather'];
type Tool = 'pen' | 'eraser';

// First the language they are comfortable in; then seven steps, the grandchild first: their name, what they love, who they are playing with;
// then the grown-up's name and loves; then they draw each other. The caricatures walk around the maps from then on.
export function Onboarding({ go }: { go: Go }) {
  const init = getState(), s = useApp(), t = useT();
  const [step, setStep] = useState(0);
  // before anything else: the language (step 1 of 8); everything on screen and the voice follow it at once
  const lang = s.lang || 'English', [langDone, setLangDone] = useState(false);
  const setLang = (l: string) => update(st => { st.lang = l; });
  const [picks, setPicks] = useState<{ dadi: string[]; child: string[] }>(() => { const ok = (l: string[]) => l.filter(k => LOVE_ICON[k]); return { dadi: ok(init.loves.dadi), child: ok(init.loves.child) }; });
  // a first run starts with empty names; running it again keeps the ones they gave
  const [names, setNames] = useState(init.onboarded ? init.names : { dadi: '', child: '' });
  const [role, setRole] = useState<string>(init.role && ROLES.includes(init.role) ? init.role : 'Grandmother');
  const [faces, setFaces] = useState(init.faces);
  const childName = names.child.trim() || 'Aarav', elderName = names.dadi.trim() || role;
  const askName = step === 0 || step === 3, picking = step === 1 || step === 4, drawing = step === 5 || step === 6;
  const who: PersonId = step <= 2 || step === 6 ? 'child' : 'dadi', color = who === 'dadi' ? DADI : CHILD, mine = picks[who];
  const toggle = (k: string) => setPicks(p => ({ ...p, [who]: p[who].includes(k) ? p[who].filter(x => x !== k) : [...p[who], k] }));

  const pad = useRef<PadApi>({ save: () => null, clear: () => {} });
  const [padBlank, setPadBlank] = useState(true);
  const mic = useMic(x => setNames(n => ({ ...n, [step === 0 ? 'child' : 'dadi']: x })), t.lang === 'hi' ? 'hi-IN' : 'en-IN');
  // the voice says what to do on each step
  const roleT = t(role), drawBy = step === 5 ? elderName : childName, drawSubj = step === 5 ? childName : elderName;
  useSay(!langDone ? null : step === 0 ? t("Hi! What's your name? Type it, or tap the mic and say it.")
    : step === 3 ? t("Namaste, {role}! What's your name? Type it, or tap the mic and say it.", { role: roleT })
    : picking ? t("{name}, what do you love? Tap everything you like, then tap That's me.", { name: who === 'dadi' ? elderName : childName })
    : step === 2 ? t("{name}, who are you playing with? Pick one, then tap That's who.", { name: childName })
    : t("{by}, now draw {subj}! Make it silly. When you're done, tap the orange button.", { by: drawBy, subj: drawSubj }), t.lang);

  const ok = drawing ? !padBlank : askName ? !!names[step === 0 ? 'child' : 'dadi'].trim() : picking ? mine.length > 0 : true;
  const next = () => {
    if (!ok) return;
    mic.stop();
    if (drawing) {
      const subj: PersonId = step === 5 ? 'child' : 'dadi', url = pad.current.save();
      const out = url ? { ...faces, [subj]: url } : faces;
      setFaces(out);
      if (step === 6) { finishOnboarding({ dadi: elderName, child: childName }, picks, out, role, lang); go({ screen: 'how' }); return; }
    }
    setStep(step + 1); setPadBlank(true);
  };

  const btn = askName ? t('Next') : step === 2 ? t("That's who") : picking ? t("That's me") : step === 5 ? t("That's {name}!", { name: childName }) : t('Start our map');
  const go1 = <button className="btn-primary" disabled={!ok} onClick={next}><Arrow />{btn}</button>;
  if (!langDone) return <LanguageStep lang={lang} setLang={setLang} next={() => setLangDone(true)} />;
  return (
    <div className="screen ob safe-top">
      <div className="ob-sub">{t('Before we begin · {n} of {total}', { n: step + 2, total: 8 })}</div>
      {askName && (
        <>
          <div className="ob-title">{step === 0 ? <><span style={{ color }}>{t('Hi!')}</span> {t("What's your name?")}</> : t.x("{role}, what's your name?", { role: <span style={{ color }}>{roleT}</span> })}</div>
          <div className="ob-name">
            <input key={step} autoFocus value={names[who]} maxLength={16} placeholder={mic.listening ? t('Listening…') : t('Your name')} style={{ color, borderBottomColor: color }}
              onChange={e => setNames({ ...names, [who]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') next(); }} />
            <button className={'ob-mic' + (mic.listening ? ' on' : '')} aria-label="Say it" onClick={mic.toggle}>
              <MicIcon size={62} />
            </button>
          </div>
          <div className="ob-micnote">{mic.error ? t("Couldn't hear that. Try again or type it.") : mic.listening ? t('Say your name…') : t('Type it, or tap the mic and say it')}</div>
          <div className="ob-actions">{go1}</div>
        </>
      )}
      {step === 2 && (
        <>
          <div className="ob-title">{t.x('{name}, who are you playing with?', { name: <span style={{ color: CHILD }}>{childName}</span> })}</div>
          <div className="ob-roles">
            {ROLES.map((r, i) => {
              const sel = role === r;
              return <button key={r} className="tile role" aria-pressed={sel} onClick={() => setRole(r)}
                style={{ background: sel ? 'rgba(47,95,208,.14)' : 'var(--cream)', color: sel ? DADI : INK, rotate: sel ? '-3deg' : i % 2 ? '1deg' : '-1deg', scale: sel ? '1.06' : '1' }}>{t(r)}</button>;
            })}
          </div>
          <div className="ob-actions">{go1}</div>
        </>
      )}
      {picking && (
        <>
          <div className="ob-title">{t.x('{name}, what do you love?', { name: <span style={{ color }}>{who === 'dadi' ? elderName : childName}</span> })}</div>
          <div className="ob-grid">
            {TILES.map(([label, k]) => {
              const sel = mine.includes(k), ic = LOVE_ICON[k];
              return (
                <button key={k} className="tile" onClick={() => toggle(k)} aria-pressed={sel}
                  style={{ background: sel ? (who === 'dadi' ? 'rgba(47,95,208,.14)' : 'rgba(228,87,46,.14)') : 'transparent', color: sel ? color : INK, rotate: sel ? '-3deg' : '0deg', scale: sel ? '1.05' : '1' }}>
                  {LOVE_ART[k] ? <img className="tile-art" src={LOVE_ART[k]} alt="" draggable={false} /> : (
                    <svg viewBox="0 0 64 64" width="80" height="80" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path d={ic.f.join(' ')} fill={sel ? ic.c : 'currentColor'} fillOpacity={sel ? 0.6 : 0.15} stroke="currentColor" strokeWidth="2.8" />
                      <path d={ic.s.join(' ')} stroke="currentColor" strokeWidth="2.8" />
                    </svg>
                  )}
                  {t(label)}
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
function useMic(onText: (t: string) => void, speechLang = 'en-IN') {
  const [listening, setListening] = useState(false), [error, setError] = useState(false), rec = useRef<any>(null), cb = useRef(onText);
  cb.current = onText;
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } rec.current = null; setListening(false); };
  useEffect(() => stop, []);
  const toggle = () => {
    if (listening) { stop(); return; }
    const w = window as any, SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setError(true); return; }
    try {
      const r = new SR(); rec.current = r; r.lang = speechLang; r.interimResults = false; r.maxAlternatives = 1;
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
  const t = useT();
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
      <div className="ob-title draw">{t.x('{by}, draw {subj}!', { by: <span style={{ color: ink }}>{by}</span>, subj: <span style={{ color: subjColor }}>{subj}</span> })}</div>
      <div className="ob-note">{t('Make it silly. Little {subj} will walk around all your maps.', { subj })}</div>
      <div className="ob-draw">
        <div className="ob-tools">
          {toolBtn('pen', t('Pencil'), <PencilIcon size={68} />)}
          {toolBtn('eraser', t('Eraser'), <EraserIcon size={68} />)}
          <button className="ob-clear" onClick={() => { api.current.clear(); onBlank(true); setTool('pen'); }}>{t('Start over')}</button>
        </div>
        <div className="face-card">
          <div className="side l" /><div className="side r" />
          <div className="face-pad" style={{ background: tint }}>
            <canvas ref={ref} width={952} height={952} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }} />
          </div>
          <div className="face-label"><span style={{ color: subjColor }}>{subj}</span><span style={{ opacity: 0.55 }}>{t('by {by}', { by })}</span></div>
        </div>
        <div className="ob-next">{next}</div>
      </div>
    </>
  );
}

/** Step 1 of 8: which language they are comfortable in (English or Hindi, each written in itself). */
function LanguageStep({ lang, setLang, next }: { lang: string; setLang: (l: string) => void; next: () => void }) {
  const [open, setOpen] = useState(false), t = useT();
  const cur = LANG_OPTIONS.find(l => l[1] === lang) || LANG_OPTIONS[0];
  useSay(t('Namaste! Which language are you comfortable in? Pick one, then tap Next.'), t.lang);
  return (
    <div className="screen ob safe-top" onClick={() => open && setOpen(false)}>
      <div className="ob-sub">{t('Before we begin · {n} of {total}', { n: 1, total: 8 })}</div>
      <div className="ob-title">{t('Which language are you comfortable in?')}</div>
      <div className="ob-note">{t('You can both change this later.')}</div>
      <div className="lang-pick" onClick={e => e.stopPropagation()}>
        <button className="lang-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="lang-name"><b>{cur[0]}</b>{cur[0] !== cur[1] && <small>{cur[1]}</small>}</span>
          <svg width="30" height="20" viewBox="0 0 30 20" style={{ rotate: open ? '180deg' : '0deg', transition: 'rotate .2s ease' }} aria-hidden="true"><path d="M4 5 L15 15 L26 5" fill="none" stroke="#F26A2E" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {open && (
          <div className="lang-list" role="listbox" aria-label={t('Language')}>
            {LANG_OPTIONS.map(([native, en]) => {
              const sel = en === lang;
              return (
                <button key={en} role="option" aria-selected={sel} className={'lang-opt' + (sel ? ' sel' : '')} onClick={() => { setLang(en); setOpen(false); }}>
                  <span className="lang-name"><b>{native}</b>{native !== en && <small>{en}</small>}</span>
                  {sel && <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden="true"><path d="M3 10 L9 16 L21 4" fill="none" stroke="#E4572E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="ob-actions lang-next"><button className="btn-primary" onClick={next}><Arrow />{t('Next')}</button></div>
    </div>
  );
}
