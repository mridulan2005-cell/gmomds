import { useEffect, useState } from 'react';
import type { Go } from '../App';
import { Arrow, Cloud, Dock, SkyBirds, Sun, type Dest } from '../components';
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
      <SkyBirds />
      <Cloud style={{ left: -30, top: 70, animation: 'drift 40s ease-in-out infinite alternate' }} />
      <Cloud w={230} style={{ right: 230, top: '38%', animation: 'drift 55s ease-in-out infinite alternate-reverse' }} />
      <Cloud w={150} style={{ left: 110, bottom: 200, animation: 'drift 48s ease-in-out infinite alternate' }} />
      <button className="gear" aria-label="Settings" onClick={() => setSettings(true)}>
        <GearIcon size={44} />
      </button>
      <div className="home-center">
        {ready ? (
          <>
            <div className="pill">{total === 1 ? 'All drawn!' : `${total} pairs!`}</div>
            <div className="home-done">Our place is ready.</div>
            <button className="btn-primary big" onClick={() => go({ screen: 'reveal' })}><Arrow w={56} h={37} />See what we made</button>
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
            {s.prompt.title && <div className="prompt-title">{s.prompt.title}</div>}
            <div className="prompt">{s.prompt.text}</div>
            {s.prompt.rule && <div className="prompt-rule"><i aria-hidden="true" />{s.prompt.rule}</div>}
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

// The two of them at the table: each drawing on their own sheet, or (on a together day, a collaborative task) on one sheet.
const ART = import.meta.env.BASE_URL + 'art/';
function SoloArt() {
  return <div className="home-art" aria-hidden="true"><img src={ART + 'separate.png'} alt="" draggable={false} /></div>;
}
function TogetherArt() {
  return <div className="home-art" aria-hidden="true"><img src={ART + 'together.png'} alt="" draggable={false} /></div>;
}
