import { useEffect, useState } from 'react';
import type { Go } from '../App';
import { Arrow, Cloud, Dock, Sun, type Dest } from '../components';
import { addSamplePairs, currentPlace, ensurePrompt, promptDone, readyToReveal, resetAll, update, useApp } from '../lib/store';
import { PAIRS, PAIRS_WORD } from '../lib/content';

export function Home({ go, dest }: { go: Go; dest: (d: Dest) => void }) {
  const s = useApp(), done = promptDone(s), ready = readyToReveal(s), place = currentPlace(s);
  const [settings, setSettings] = useState(false);
  useEffect(() => { void ensurePrompt(); }, []);
  const resumeChild = !!(s.scanning && s.prompt && s.scanning.promptId === s.prompt.id && s.scanning.dadi && s.drawings[s.scanning.dadi]);

  return (
    <div className="screen home">
      <Sun />
      <Cloud style={{ left: -30, top: 70, animation: 'drift 40s ease-in-out infinite alternate' }} />
      <Cloud w={230} style={{ right: 230, top: '38%', animation: 'drift 55s ease-in-out infinite alternate-reverse' }} />
      <Cloud w={150} style={{ left: 110, bottom: 200, animation: 'drift 48s ease-in-out infinite alternate' }} />
      <button className="gear" aria-label="Settings" onClick={() => setSettings(true)}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1F4C4A" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>
      </button>
      <div className="home-center">
        {ready ? (
          <>
            <div className="pill">{PAIRS_WORD} pairs!</div>
            <div className="home-done">Our place is ready.</div>
            <button className="btn-primary big" onClick={() => go({ screen: 'reveal' })}><Arrow w={46} h={30} />See what we made</button>
          </>
        ) : done ? (
          <>
            <div className="pill">All done for today</div>
            <div className="home-done">Today's drawings are on the map.</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#1F4C4A', opacity: 0.75 }}>A new prompt arrives tomorrow.</div>
          </>
        ) : s.prompt ? (
          <>
            <div className="pill">Today's prompt</div>
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
  const s = useApp(), place = currentPlace(s);
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
          <button className="btn-cream small" disabled={!place || place.pairs.length >= PAIRS} onClick={() => addSamplePairs(1)}>Add a sample pair</button>
          <button className="btn-cream small" disabled={!place || place.pairs.length >= PAIRS - 1} onClick={() => addSamplePairs(PAIRS - 1 - (place?.pairs.length || 0))}>Fill to {PAIRS - 1} pairs</button>
        </div>
        <p style={{ fontSize: 16 }}>Sample pairs use placeholder drawings so you can try the map and the reveal without waiting a week. "New prompt now" skips to the next day's prompt.</p>
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
