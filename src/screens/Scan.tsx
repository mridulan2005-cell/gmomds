import { useCallback, useEffect, useRef, useState } from 'react';
import type { Go } from '../App';
import { Arrow, Perforation } from '../components';
import { DADI, CHILD, QUICK_PICKS, fillFor, guessFor } from '../lib/content';
import { addDrawing, getState, replaceDrawing, saveScan, uid, updateDrawing, useApp } from '../lib/store';
import type { Drawing, Guess } from '../lib/types';
import { detect, grab, process, recognise, thumb, thumbDiff, toBlob, toCanvas } from '../scan/scanner';
import { warmClip } from '../scan/clip';
import { warmDoodle } from '../scan/doodle';
import type { Img, Quad, ScanError } from '../scan/pipeline';

type Phase = 'starting' | 'camera' | 'nocam' | 'processing' | 'scanning' | 'done' | 'error';
let lastCapture: Float32Array | null = null; // so the grandchild's turn doesn't re-scan Dadi's sheet
let preferFront = true; // the front camera by default; "Switch camera" flips it
// Some cameras send a mirrored picture (writing comes out backwards). "Flip" turns it the right way round, per camera, and is remembered.
const flipKey = () => 'dadis-map:flip:' + (preferFront ? 'user' : 'environment');
const readFlip = () => { try { return localStorage.getItem(flipKey()) === '1'; } catch { return false; } };
const TAKE = /\b(take|take it|click|snap|cheese)\b|टेक|ले लो|खींचो/; // spoken words that take the photo

/** `replace`: a retake of a drawing already scanned (from today's sketches); the new scan takes its place. */
export function Scan({ who, go, replace }: { who: 'dadi' | 'child'; go: Go; replace?: string }) {
  const s = useApp(), name = who === 'dadi' ? s.names.dadi : s.names.child, color = who === 'dadi' ? DADI : CHILD;
  const [phase, setPhase] = useState<Phase>('starting');
  const [err, setErr] = useState<ScanError | 'not-drawing' | 'camera' | 'failed' | null>(null);
  const [quad, setQuad] = useState<{ q: Quad; w: number; h: number } | null>(null);
  const [steady, setSteady] = useState(0);
  const [still, setStill] = useState<string | null>(null);
  const frameUrl = useRef<string | null>(null); // the full photo, kept so a failed scan can be saved and looked at
  const [cropUrl, setCropUrl] = useState<string | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [flip, setFlip] = useState(readFlip); const flipRef = useRef(flip); flipRef.current = flip;
  const [hands, setHands] = useState(false), [listening, setListening] = useState(false);
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), fileIn = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const hist = useRef<Quad[]>([]), busy = useRef(false), alive = useRef(true);
  const drawing = drawingId ? s.drawings[drawingId] : null;
  const replacing = useRef(replace); // the drawing the next capture replaces (a retake)

  // the grandchild scans second; if Dadi's scan is missing, start with Dadi
  useEffect(() => {
    const st = getState();
    if (replace) { if (!st.drawings[replace]) go({ screen: 'sketches' }); }
    else if (!st.prompt) go({ screen: 'home' });
    else if (who === 'child' && !(st.scanning && st.scanning.promptId === st.prompt.id && st.scanning.dadi)) go({ screen: 'scan', who: 'dadi' });
  }, []);

  const stopCamera = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  const startCamera = useCallback(async () => {
    stopCamera(); setPhase('starting'); hist.current = []; setQuad(null); setSteady(0);
    if (!navigator.mediaDevices?.getUserMedia) { setErr('camera'); setPhase('nocam'); return; }
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: preferFront ? 'user' : 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (!alive.current) { ms.getTracks().forEach(t => t.stop()); return; }
      stream.current = ms;
      const v = video.current!; v.srcObject = ms; v.muted = true; v.playsInline = true; await v.play().catch(() => {});
      setPhase('camera'); setErr(null);
    } catch { setErr('camera'); setPhase('nocam'); }
  }, []);
  useEffect(() => {
    warmDoodle();
    // without Claude on the server, the free on-device recogniser does the naming: start fetching it now
    fetch('/api/health').then(r => r.json()).then(h => { if (!h?.ai) warmClip(getState().prompt?.text || ''); }).catch(() => warmClip(getState().prompt?.text || ''));
  }, []);
  useEffect(() => { alive.current = true; void startCamera(); return () => { alive.current = false; stopCamera(); }; }, [startCamera]);

  // auto-capture: a sheet is found and held still for about a second
  useEffect(() => {
    const t = setInterval(async () => {
      if (phaseRef.current !== 'camera' || busy.current || !video.current) return;
      const f = grab(video.current, 320, flipRef.current); if (!f) return;
      busy.current = true;
      const th = thumb(f), w = f.width, h = f.height;
      const sh = await detect(f).catch(() => null), q = sh?.quad || null;
      busy.current = false;
      if (phaseRef.current !== 'camera') return;
      setQuad(q ? { q, w, h } : null); setHands(!!sh?.hands);
      // wait for the hands to move away before taking the photo by itself
      if (!q || sh?.hands) { hist.current = []; setSteady(0); return; }
      const H = hist.current; H.push(q); if (H.length > 4) H.shift();
      const diag = Math.hypot(w, h), moved = H.length > 1 ? Math.max(...H.slice(1).map((p, i) => Math.max(...p.map((c, k) => Math.hypot(c[0] - H[i][k][0], c[1] - H[i][k][1]))))) : 1e9;
      const isNew = !lastCapture || thumbDiff(th, lastCapture) > 0.045;
      const n = moved < diag * 0.02 && isNew ? H.length : 0; setSteady(n);
      if (n >= 4) void captureRef.current('camera');
    }, 280);
    return () => clearInterval(t);
  }, []);

  // voice: say "take" once the drawing is in the frame
  useEffect(() => {
    const w = window as any, SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    let stopped = false, rec: any = null, retry = 0;
    const onGesture = () => { window.removeEventListener('pointerdown', onGesture); start(); };
    const start = () => {
      if (stopped || rec) return;
      rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!TAKE.test(String(e.results[i][0]?.transcript || '').toLowerCase()) || phaseRef.current !== 'camera') continue;
          void captureRef.current('camera'); try { rec.abort(); } catch { /* restarts on end */ } return;
        }
      };
      rec.onstart = () => setListening(true);
      rec.onerror = (e: any) => {
        // some browsers only let the microphone start after a tap
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped = !!retry; retry++; window.addEventListener('pointerdown', onGesture); }
      };
      rec.onend = () => { rec = null; setListening(false); if (!stopped) setTimeout(start, 400); };
      try { rec.start(); } catch { rec = null; }
    };
    start();
    return () => { stopped = true; window.removeEventListener('pointerdown', onGesture); try { rec?.abort(); } catch { /* already stopped */ } };
  }, []);

  const captureRef = useRef<(from: 'camera' | Img) => Promise<void>>(async () => {});
  const capture = captureRef.current = async (from: 'camera' | Img) => {
    if (phaseRef.current === 'processing' || phaseRef.current === 'scanning') return;
    const frame = from === 'camera' ? (video.current ? grab(video.current, 1600, flipRef.current) : null) : from;
    if (!frame) return;
    phaseRef.current = 'processing'; setPhase('processing'); setQuad(null);
    lastCapture = thumb(frame);
    setStill(toCanvas(frame, 900).toDataURL('image/jpeg', 0.8));
    frameUrl.current = toCanvas(frame).toDataURL('image/jpeg', 0.92);
    try {
      const r = await process(frame); // (frame's pixels move to the worker here)
      if (!r.ok || !r.crop || !r.vector) { setErr(r.error || 'failed'); setPhase('error'); return; }
      const crop = r.crop, cropCanvas = toCanvas(crop, 1200), jpeg = await toBlob(cropCanvas);
      setCropUrl(URL.createObjectURL(jpeg)); setPhase('scanning');
      const started = performance.now(), old = replacing.current ? getState().drawings[replacing.current] : undefined;
      const prompt = (old && getState().months.flatMap(m => m.places.flatMap(p => p.pairs)).find(p => p.promptId === old.promptId)?.prompt) || getState().prompt?.text || '';
      const rec = await recognise(crop, prompt, who, r.vector);
      if (rec.notDrawing) { setErr('not-drawing'); setPhase('error'); return; }
      await new Promise(res => setTimeout(res, Math.max(0, 2600 - (performance.now() - started))));
      const st = getState(), id = uid();
      const { art, ...paths } = r.vector; // the drawing's own image is stored as a blob, not in the state
      const artBlob = art ? await toBlob(toCanvas(art), 'image/jpeg', 0.92).catch(() => null) : null;
      const d: Drawing = {
        id, personId: who, promptId: old ? old.promptId : st.prompt?.id || '', createdAt: Date.now(), paths, hasArt: !!artBlob,
        kind: rec.kind, label: rec.label, motion: rec.motion, place: rec.place, fillColor: fillFor(rec.kind, who === 'dadi' ? 0 : 1),
        confidence: rec.confidence, alternatives: rec.alternatives || [], source: rec.source,
      };
      await saveScan(id, jpeg);
      if (artBlob) await saveScan(id, artBlob, 'art');
      if (old) replaceDrawing(old.id, d); else addDrawing(d);
      replacing.current = id; // a further retake replaces this one
      setDrawingId(id); setPhase('done'); stopCamera();
      if (rec.source === 'local' && rec.confidence < 0.5) setFixing(true); // not sure: ask which it is, best guesses first
    } catch (e) { console.error(e); setErr('failed'); setPhase('error'); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { const bmp = await createImageBitmap(file); const f = grab(bmp, 1600); bmp.close(); if (f) void capture(f); }
    catch { setErr('failed'); setPhase('error'); }
  };
  const retry = () => { setStill(null); setCropUrl(null); setErr(null); if (stream.current) setPhase('camera'); else void startCamera(); };
  // scan this drawing again: the camera reopens and the new scan replaces the one just made
  const retake = () => { lastCapture = null; setDrawingId(null); setFixing(false); retry(); };
  const choose = (g: Guess) => { if (drawingId) updateDrawing(drawingId, { kind: g.kind, label: g.label, motion: g.motion, place: g.place, fillColor: fillFor(g.kind, who === 'dadi' ? 0 : 1), confidence: 1 }); setFixing(false); };

  const live = phase === 'camera' || phase === 'starting';
  const head = phase === 'processing' || phase === 'scanning' ? <span>Scanning. Keep it still.</span>
    : phase === 'done' ? <span>It's scanned!</span>
    : phase === 'error' ? <span>{err === 'blurry' ? 'That came out a bit blurry' : err === 'empty' ? "We couldn't see a drawing" : err === 'not-drawing' ? 'That looks like more than a drawing' : 'Let’s try that again'}</span>
    : <><span>Put</span><span className="name-tag" style={{ background: color }}>{name}</span><span>'s drawing on the tray</span></>;

  return (
    <div className="screen scan safe-top">
      <svg width="300" height="200" viewBox="0 0 300 200" style={{ position: 'absolute', left: 40, top: '38%' }} fill="none" stroke="#FFF3D1" strokeWidth="7" strokeLinecap="round" strokeDasharray="0 18"><path d="M10 40 Q80 -10 120 60 T230 90 T290 180" /></svg>
      <div className="scan-head">{head}</div>
      <div className="tray-wrap">
        <div className="tray" style={{ color }}>
          <Perforation />
          <div className="tray-inner" style={{ background: who === 'dadi' ? '#DCE6FA' : '#FBE1D7' }}>
            <video ref={video} playsInline muted autoPlay style={{ display: live ? 'block' : 'none', transform: flip ? 'scaleX(-1)' : undefined }} />
            {live && quad && (
              <svg className="quad-overlay" viewBox={`0 0 ${quad.w} ${quad.h}`} preserveAspectRatio="xMidYMid slice">
                <polygon points={quad.q.map(p => `${p[0]},${p[1]}`).join(' ')} fill="rgba(255,201,60,.18)" stroke="#FFC93C" strokeWidth={quad.w / 90} strokeLinejoin="round" />
              </svg>
            )}
            {live && <div className="hold">{phase === 'starting' ? 'Opening the camera…' : hands ? 'Hands away from the paper' : quad ? (steady >= 2 ? 'Hold still…' : 'Found the paper') : 'Paper goes here'}</div>}
            {live && listening && <div className="say-take">🎤 Say “take”</div>}
            {phase === 'nocam' && <div className="paper-slot">Paper goes here</div>}
            {(phase === 'processing' || phase === 'error') && still && <img className="still" src={still} alt="" style={{ objectFit: 'cover', opacity: phase === 'error' ? 0.45 : 1 }} />}
            {(phase === 'scanning' || phase === 'done') && cropUrl && (
              <div className="scan-paper">
                <img src={cropUrl} alt="The scanned drawing" style={{ animation: phase === 'scanning' ? 'develop 2.4s ease-in-out both' : 'none' }} />
                {phase === 'scanning' && <div className="scanbar" />}
              </div>
            )}
          </div>
          <div className="tray-foot"><span>{name}</span><span style={{ opacity: 0.55, color: '#3d2b22' }}>{who === 'dadi' ? '1 of 2' : '2 of 2'}</span></div>
          {phase === 'done' && <div className="check"><svg width="40" height="40" viewBox="0 0 28 28" fill="none" stroke="#FFF3D1" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15 L11 21 L23 7" /></svg></div>}
        </div>

        <div className="scan-actions">
          {phase === 'done' && drawing && (
            <div className="guess">
              <span>Looks like</span><span className="chip">{drawing.label}</span>
              <button className="link" onClick={() => setFixing(true)}>Not quite?</button>
            </div>
          )}
          {phase === 'nocam' && <div className="notice">The camera isn't available here. You can take or choose a photo of the drawing instead.</div>}
          {phase === 'error' && <div className="notice">{err === 'blurry' ? 'Hold the tablet still and try again.' : err === 'empty' ? 'We found the paper but no pencil marks on it. Make sure the drawing faces the camera, or press a little harder with the pencil, and try again.' : err === 'not-drawing' ? 'Hold the paper so it fills most of the picture, with nothing else in front of it, and try again.' : 'Something went wrong while scanning. Please try again.'}</div>}

          {(phase === 'processing' || phase === 'scanning') && <div className="busy">Scanning…</div>}
          {live && <button className="btn-primary" disabled={phase === 'starting'} onClick={() => void capture('camera')}><Arrow />It's on the tray</button>}
          {phase === 'nocam' && <button className="btn-primary" onClick={() => fileIn.current?.click()}><Arrow />Choose a photo</button>}
          {phase === 'error' && <button className="btn-primary" onClick={retry}><Arrow />Try again</button>}
          {phase === 'done' && (replace || who === 'child'
            ? <button className="btn-primary" onClick={() => go({ screen: 'sketches' })}><Arrow />See today's sketches</button>
            : <button className="btn-primary" onClick={() => go({ screen: 'scan', who: 'child' })}><Arrow />Now {s.names.child}'s turn</button>)}
          {phase === 'done' && <div className="scan-secondary"><button className="btn-cream small" onClick={retake}>Retake</button></div>}

          {(live || phase === 'error') && (
            <div className="scan-secondary">
              <button className="btn-cream small" onClick={() => fileIn.current?.click()}>Use a photo</button>
              {phase === 'error' && frameUrl.current && <a className="btn-cream small" href={frameUrl.current} download="dadis-map-scan.jpg">Save this photo</a>}
              {live && <button className="btn-cream small" onClick={() => { preferFront = !preferFront; setFlip(readFlip()); void startCamera(); }}>Switch camera</button>}
              {live && <button className="btn-cream small" onClick={() => { const f = !flip; setFlip(f); hist.current = []; try { localStorage.setItem(flipKey(), f ? '1' : '0'); } catch { /* not remembered */ } }}>Flip</button>}
              <button className="btn-cream small" onClick={() => go(replace ? { screen: 'sketches' } : { screen: 'home' })}>Not now</button>
            </div>
          )}
        </div>
      </div>
      <input ref={fileIn} type="file" accept="image/*" hidden onChange={onFile} />
      {fixing && drawing && <FixSheet d={drawing} onPick={choose} close={() => setFixing(false)} />}
    </div>
  );
}

function FixSheet({ d, onPick, close }: { d: Drawing; onPick: (g: Guess) => void; close: () => void }) {
  const opts: Guess[] = [...d.alternatives, ...QUICK_PICKS.map(guessFor)].filter((g, i, a) => g.kind !== d.kind && a.findIndex(x => x.kind === g.kind) === i).slice(0, 14);
  const [typed, setTyped] = useState('');
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>{d.source === 'local' && d.confidence < 0.5 ? `Is it ${d.label}?` : 'What did you draw?'}</h2>
        <p>{d.source === 'local' && d.confidence < 0.5 ? 'Or tap the right one, and it will move the right way on the map.' : 'Tap the right one, and it will move the right way on the map.'}</p>
        <div className="chips">{opts.map(g => <button key={g.kind} onClick={() => onPick(g)}>{g.label.replace(/^(a|an|the) /, '')}</button>)}</div>
        <div className="row">
          Something else: <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="e.g. rabbit" />
          <button className="btn-cream small" disabled={!typed.trim()} onClick={() => { const k = typed.trim().toLowerCase().split(/\s+/).pop()!; const g = guessFor(k); onPick({ ...g, label: typed.trim() }); }}>That's it</button>
        </div>
        <button className="btn-primary" style={{ height: 60, fontSize: 22, padding: '0 28px' }} onClick={close}>Keep "{d.label}"</button>
      </div>
    </div>
  );
}
