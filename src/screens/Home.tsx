import { useEffect, useState } from 'react';
import type { Go } from '../App';
import { Arrow, Cloud, Dock, Sun, type Dest } from '../components';
import { GearIcon } from '../icons';
import { addSamplePairs, currentPlace, ensurePrompt, nextPromptAt, placeTotal, promptDone, readyToReveal, resetAll, update, useApp } from '../lib/store';

const DAY = 86_400_000, p2 = (v: number) => String(Math.floor(v)).padStart(2, '0');

export function Home({ go, dest }: { go: Go; dest: (d: Dest) => void }) {
  const s = useApp(), done = promptDone(s), ready = readyToReveal(s), place = currentPlace(s);
  const [settings, setSettings] = useState(false);
  useEffect(() => { void ensurePrompt(); }, []);
  const resumeChild = !!(s.scanning && s.prompt && s.scanning.promptId === s.prompt.id && s.scanning.dadi && s.drawings[s.scanning.dadi]);
  // on a together day they draw on one sheet, and the sky turns warm
  const together = !!s.prompt?.together && !done && !ready;

  // after today's pair, the wait for the next prompt ticks down; at zero the next prompt arrives
  const waiting = done && !ready;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!waiting) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [waiting]);
  const rem = Math.max(0, nextPromptAt(s) - now);
  useEffect(() => { if (waiting && rem === 0) void ensurePrompt(); }, [waiting, rem === 0]);
  const n = place ? place.pairs.length : 0, total = place ? placeTotal(place) : 0;

  return (
    <div className={'screen home' + (together ? ' together' : '')}>
      <Sun />
      <Cloud style={{ left: -30, top: 70, animation: 'drift 40s ease-in-out infinite alternate' }} />
      <Cloud w={230} style={{ right: 230, top: '38%', animation: 'drift 55s ease-in-out infinite alternate-reverse' }} />
      <Cloud w={150} style={{ left: 110, bottom: 200, animation: 'drift 48s ease-in-out infinite alternate' }} />
      <button className="gear" aria-label="Settings" onClick={() => setSettings(true)}>
        <GearIcon size={32} />
      </button>
      <div className="home-center">
        {ready ? (
          <>
            <div className="pill">{total} pairs!</div>
            <div className="home-done">Our place is ready.</div>
            <button className="btn-primary big" onClick={() => go({ screen: 'reveal' })}><Arrow w={46} h={30} />See what we made</button>
          </>
        ) : done ? (
          <>
            <div className="pill">All done for today</div>
            <div className="home-done wait">Next prompt in</div>
            <div className="countdown">
              <div className="cd-clock" aria-hidden="true">
                <div className="cd-bell" /><div className="cd-hand" />
                <div className="cd-face">
                  <svg width="150" height="150" viewBox="-10 -10 20 20"><path d="M0 -10 Q1.6 -1.6 10 0 Q1.6 1.6 0 10 Q-1.6 1.6 -10 0 Q-1.6 -1.6 0 -10Z" fill="#FFC93C" /></svg>
                  <div className="cd-day"><span>Day</span><b>{n + 1}</b></div>
                </div>
              </div>
              <div className="cd-bar">
                <div className="cd-time" role="timer">{p2(rem / 36e5)}:{p2((rem / 6e4) % 60)}:{p2((rem / 1e3) % 60)}</div>
                <div className="cd-track"><div style={{ width: Math.min(100, 100 - (rem / DAY) * 100).toFixed(2) + '%' }} /></div>
              </div>
            </div>
            {place && <div className="home-sub">??? · prompt {n + 1} of {total}</div>}
          </>
        ) : s.prompt ? (
          <>
            {together ? <TogetherArt /> : <SoloArt />}
            <div className="prompt">{s.prompt.text}</div>
            <button className="btn-primary big" style={{ marginTop: 14 }} onClick={() => go({ screen: 'scan', who: resumeChild ? 'child' : 'dadi' })}>
              <Arrow w={46} h={30} />{resumeChild ? `${s.names.child}'s turn` : "We're done!"}
            </button>
          </>
        ) : (
          <div className="prompt" style={{ fontSize: 48, opacity: 0.6 }}>{place ? 'Finding today’s prompt…' : ''}</div>
        )}
      </div>
      <Dock items={['map', 'book']} go={dest} />
      {settings && <Settings close={() => setSettings(false)} />}
    </div>
  );
}

function Settings({ close }: { close: () => void }) {
  const s = useApp(), place = currentPlace(s), total = place ? placeTotal(place) : 0;
  const [ai, setAi] = useState<string>('checking…');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(j => setAi(j.ai ? 'Claude is connected (' + j.model + ')' : 'No API key on the server: using offline guesses')).catch(() => setAi('Offline: using offline guesses'));
  }, []);
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Settings</h2>
        <p>{ai}</p>
        <div className="row">Dadi <input value={s.names.dadi} maxLength={14} onChange={e => update(st => { st.names.dadi = e.target.value; })} />
          Grandchild <input value={s.names.child} maxLength={14} onChange={e => update(st => { st.names.child = e.target.value; })} /></div>
        <div className="row">
          <button className="btn-cream small" onClick={() => { void ensurePrompt(true); close(); }}>New prompt now</button>
          <button className="btn-cream small" disabled={!place || place.pairs.length >= total} onClick={() => addSamplePairs(1)}>Add a sample pair</button>
          <button className="btn-cream small" disabled={!place || place.pairs.length >= total - 1} onClick={() => addSamplePairs(total - 1 - (place?.pairs.length || 0))}>Fill to {total - 1} pairs</button>
          <button className="btn-cream small" disabled={!s.doneAt} onClick={() => { update(st => { st.doneAt = Date.now() - DAY; }); void ensurePrompt(); close(); }}>Skip the wait</button>
        </div>
        <p style={{ fontSize: 16 }}>Sample pairs use placeholder drawings so you can try the map and the reveal without waiting. "New prompt now" and "Skip the wait" skip ahead to the next prompt.</p>
        <div className="row">
          {!confirm ? <button className="btn-cream small danger" onClick={() => setConfirm(true)}>Start over…</button>
            : <button className="btn-cream small danger" onClick={async () => { await resetAll(); location.reload(); }}>Yes, delete everything</button>}
          <span style={{ flex: 1 }} />
          <button className="btn-primary" style={{ height: 60, fontSize: 22, padding: '0 28px' }} onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

// The two of them at the table: each drawing on their own sheet, or (on a together day) on one big sheet.
const DadiFace = ({ x }: { x: number }) => (
  <svg width="96" height="96" viewBox="0 0 96 96" fill="none" strokeLinecap="round" style={{ position: 'absolute', left: x, top: 2 }}><circle cx="48" cy="20" r="13" fill="#C9C4BC" /><circle cx="48" cy="54" r="36" fill="#C98B5A" /><path d="M14 48 Q16 18 48 18 Q80 18 82 48 Q70 32 48 32 Q26 32 14 48 Z" fill="#C9C4BC" /><circle cx="36" cy="54" r="9" stroke="#3d2b22" strokeWidth="3" /><circle cx="60" cy="54" r="9" stroke="#3d2b22" strokeWidth="3" /><path d="M45 54 H51" stroke="#3d2b22" strokeWidth="3" /><path d="M38 72 Q48 79 58 72" stroke="#3d2b22" strokeWidth="3" /></svg>
);
const ChildFace = ({ x }: { x: number }) => (
  <svg width="66" height="66" viewBox="0 0 66 66" fill="none" strokeLinecap="round" style={{ position: 'absolute', left: x, top: 48 }}><circle cx="33" cy="35" r="29" fill="#C98B5A" /><path d="M4 32 Q6 6 33 6 Q60 6 62 32 Q50 20 33 20 Q16 20 4 32 Z" fill="#3d2b22" /><circle cx="24" cy="36" r="3" fill="#3d2b22" /><circle cx="42" cy="36" r="3" fill="#3d2b22" /><path d="M25 47 Q33 53 41 47" stroke="#3d2b22" strokeWidth="3" /></svg>
);
function SoloArt() {
  return (
    <div className="home-art" aria-hidden="true">
      <svg width="420" height="230" viewBox="0 0 420 230" fill="none" strokeLinecap="round" style={{ position: 'absolute', inset: 0 }}>
        <path d="M70 162 Q70 94 125 94 Q180 94 180 162 Z" fill="#2F5FD0" /><path d="M250 162 Q250 114 290 114 Q330 114 330 162 Z" fill="#E4572E" />
        <rect x="0" y="150" width="420" height="80" rx="8" fill="#DDB98F" />
        <g transform="rotate(-3 110 190)"><rect x="40" y="166" width="140" height="50" fill="#FFFFFF" stroke="#3d2b22" strokeWidth="1.5" /><path d="M58 196 Q76 178 92 196 T128 192" stroke="#2F5FD0" strokeWidth="4" /></g>
        <g transform="rotate(2 310 190)"><rect x="240" y="166" width="140" height="50" fill="#FFFFFF" stroke="#3d2b22" strokeWidth="1.5" /><path d="M262 198 Q282 176 300 196 T344 190" stroke="#E4572E" strokeWidth="4" /></g>
        <path d="M160 122 Q176 154 150 190" stroke="#C98B5A" strokeWidth="14" /><path d="M272 130 Q258 162 290 192" stroke="#C98B5A" strokeWidth="12" />
      </svg>
      <DadiFace x={77} /><ChildFace x={257} />
    </div>
  );
}
function TogetherArt() {
  return (
    <div className="home-art" aria-hidden="true">
      <svg width="420" height="230" viewBox="0 0 420 230" fill="none" strokeLinecap="round" style={{ position: 'absolute', inset: 0 }}>
        <path d="M108 162 Q108 94 163 94 Q218 94 218 162 Z" fill="#2F5FD0" /><path d="M228 162 Q228 114 268 114 Q308 114 308 162 Z" fill="#E4572E" />
        <rect x="0" y="150" width="420" height="80" rx="8" fill="#DDB98F" />
        <g transform="rotate(-1 210 190)"><rect x="100" y="162" width="220" height="56" fill="#FFFFFF" stroke="#3d2b22" strokeWidth="1.5" /><path d="M120 200 Q140 178 160 198 T206 192" stroke="#2F5FD0" strokeWidth="4" /><path d="M208 192 Q230 176 250 198 T300 190" stroke="#E4572E" strokeWidth="4" /></g>
        <path d="M200 124 Q216 156 194 194" stroke="#C98B5A" strokeWidth="14" /><path d="M248 130 Q234 162 224 194" stroke="#C98B5A" strokeWidth="12" />
      </svg>
      <DadiFace x={115} /><ChildFace x={235} />
    </div>
  );
}
