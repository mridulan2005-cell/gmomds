import { useCallback, useRef, useState } from 'react';
import type { Go } from '../App';
import { Arrow } from '../components';
import { DADI, CHILD, ICON, INK, NC, TILES } from '../lib/content';
import { finishOnboarding, getState } from '../lib/store';
import type { PersonId } from '../lib/types';

// Four steps: Dadi's loves, Dadi draws the grandchild, the grandchild's loves, the grandchild draws Dadi.
// The caricatures walk around the maps from then on.
export function Onboarding({ go }: { go: Go }) {
  const init = getState();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<{ dadi: string[]; child: string[] }>({ dadi: init.loves.dadi, child: init.loves.child });
  const [names, setNames] = useState(init.names);
  const [faces, setFaces] = useState(init.faces);
  const drawing = step === 1 || step === 3;
  const who = step < 2 ? 'dadi' : 'child', color = who === 'dadi' ? DADI : CHILD, mine = picks[who];
  const dadiName = names.dadi.trim() || 'Sunita', childName = names.child.trim() || 'Aarav';
  const toggle = (k: string) => setPicks(p => ({ ...p, [who]: p[who].includes(k) ? p[who].filter(x => x !== k) : [...p[who], k] }));

  const pad = useRef<PadApi>({ save: () => null, clear: () => {} });
  const [padBlank, setPadBlank] = useState(false);

  const next = () => {
    if (drawing) {
      if (padBlank) return;
      const subj: PersonId = step === 1 ? 'child' : 'dadi', url = pad.current.save();
      const out = url ? { ...faces, [subj]: url } : faces;
      setFaces(out);
      if (step === 3) { finishOnboarding({ dadi: dadiName, child: childName }, picks, out); go({ screen: 'home' }); return; }
    } else if (!mine.length) return;
    setStep(step + 1); setPadBlank(false);
  };

  const btn = step === 0 ? "That's me" : step === 1 ? `That's ${childName}!` : step === 2 ? "That's me" : "That's Dadi! Start our map";
  return (
    <div className="screen ob safe-top">
      <div className="ob-sub">Before we begin · {step + 1} of 4</div>
      {drawing ? (
        <DrawFace key={step} by={step === 1 ? dadiName : childName} subj={step === 1 ? childName : 'Dadi'}
          ink={step === 1 ? DADI : CHILD} subjColor={step === 1 ? CHILD : DADI} tint={step === 1 ? '#EEF2FC' : '#FDF0EA'}
          start={faces[step === 1 ? 'child' : 'dadi']} api={pad} onBlank={setPadBlank} />
      ) : (
        <>
          <div className="ob-title"><span style={{ color }}>{who === 'dadi' ? dadiName : names.child || 'Your grandchild'}</span>, what do you love?</div>
          {step === 2 && (
            <label className="name-field" style={{ color: CHILD }}>
              My name is
              <input value={names.child} maxLength={14} onChange={e => setNames({ ...names, child: e.target.value })} placeholder="Name" />
            </label>
          )}
          <div className="ob-grid">
            {TILES.map(([label, k]) => {
              const sel = mine.includes(k), ic = ICON[k];
              return (
                <button key={k} className="tile" onClick={() => toggle(k)} aria-pressed={sel}
                  style={{ background: sel ? (who === 'dadi' ? 'rgba(47,95,208,.14)' : 'rgba(228,87,46,.14)') : 'transparent', color: sel ? color : INK, rotate: sel ? '-3deg' : '0deg', scale: sel ? '1.05' : '1' }}>
                  <svg viewBox="0 0 64 64" width="80" height="80" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path d={ic.f.join(' ')} fill={sel ? NC[k] : 'currentColor'} fillOpacity={sel ? 0.6 : 0.15} stroke="currentColor" strokeWidth="2.8" />
                    <path d={ic.s.join(' ')} stroke="currentColor" strokeWidth="2.8" />
                  </svg>
                  {label}
                  {who === 'child' && picks.dadi.includes(k) && <div className="dot" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="ob-actions">
        {drawing && <button className="btn-cream" style={{ rotate: '1deg' }} onClick={() => { pad.current.clear(); setPadBlank(true); }}>Start over</button>}
        <button className="btn-primary" disabled={drawing ? padBlank : !mine.length} onClick={next}><Arrow />{btn}</button>
      </div>
    </div>
  );
}

interface PadApi { save: () => string | null; clear: () => void }

/** A paper card to draw the other person on with a finger. It starts with the current caricature (the placeholder sketch at first). */
function DrawFace({ by, subj, ink, subjColor, tint, start, api, onBlank }: {
  by: string; subj: string; ink: string; subjColor: string; tint: string; start: string;
  api: React.MutableRefObject<PadApi>; onBlank: (b: boolean) => void;
}) {
  const cv = useRef<HTMLCanvasElement | null>(null), dirty = useRef(false), stroke = useRef(false);
  const ref = useCallback((c: HTMLCanvasElement | null) => {
    cv.current = c; if (!c) return;
    const x = c.getContext('2d')!, img = new Image();
    img.onload = () => { if (cv.current === c && !dirty.current) x.drawImage(img, 0, 0, c.width, c.height); };
    img.src = start;
    api.current = {
      save: () => (dirty.current && cv.current ? cv.current.toDataURL('image/png') : null),
      clear: () => { x.clearRect(0, 0, c.width, c.height); dirty.current = true; },
    };
  }, []);
  const pt = (e: React.PointerEvent) => { const c = cv.current!, r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]; };
  const down = (e: React.PointerEvent) => {
    const c = cv.current; if (!c) return; c.setPointerCapture?.(e.pointerId);
    const x = c.getContext('2d')!, [px, py] = pt(e);
    x.strokeStyle = ink; x.lineWidth = 12; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + 0.1, py); x.stroke();
    stroke.current = true; dirty.current = true; onBlank(false);
  };
  const move = (e: React.PointerEvent) => { if (!stroke.current || !cv.current) return; const x = cv.current.getContext('2d')!, [px, py] = pt(e); x.lineTo(px, py); x.stroke(); };
  const up = () => { stroke.current = false; };
  return (
    <>
      <div className="ob-title"><span style={{ color: ink }}>{by}</span>, draw <span style={{ color: subjColor }}>{subj}</span>!</div>
      <div className="ob-note">Make it silly. Little {subj} will walk around all your maps.</div>
      <div className="face-card">
        <div className="face-pad" style={{ background: tint }}>
          <canvas ref={ref} width={712} height={712} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
        <div className="face-label"><span style={{ color: subjColor }}>{subj}</span><span style={{ opacity: 0.55 }}>by {by}</span></div>
      </div>
    </>
  );
}
