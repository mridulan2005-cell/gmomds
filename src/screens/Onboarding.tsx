import { useState } from 'react';
import type { Go } from '../App';
import { Arrow } from '../components';
import { DADI, CHILD, ICON, INK, NC, TILES } from '../lib/content';
import { finishOnboarding, getState } from '../lib/store';

export function Onboarding({ go }: { go: Go }) {
  const init = getState();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<{ dadi: string[]; child: string[] }>({ dadi: init.loves.dadi, child: init.loves.child });
  const [names, setNames] = useState(init.names);
  const who = step === 0 ? 'dadi' : 'child', color = who === 'dadi' ? DADI : CHILD, mine = picks[who];
  const toggle = (k: string) => setPicks(p => ({ ...p, [who]: p[who].includes(k) ? p[who].filter(x => x !== k) : [...p[who], k] }));
  const next = () => {
    if (!mine.length) return;
    if (step === 0) setStep(1);
    else { finishOnboarding({ dadi: names.dadi.trim() || 'Sunita', child: names.child.trim() || 'Aarav' }, picks); go({ screen: 'home' }); }
  };
  return (
    <div className="screen ob safe-top">
      <div className="ob-sub">Before we begin · {step + 1} of 2</div>
      <div className="ob-title"><span style={{ color }}>{who === 'dadi' ? names.dadi || 'Sunita' : names.child || 'Your grandchild'}</span>, what do you love?</div>
      {step === 1 && (
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
      <button className="btn-primary" style={{ marginTop: 40 }} disabled={!mine.length} onClick={next}><Arrow />{step === 0 ? "That's me" : 'Start our map'}</button>
    </div>
  );
}
