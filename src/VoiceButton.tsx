import { useRef, useState } from 'react';
import { setMuted, useMuted } from './lib/voice';
import { useT } from './lib/i18n';

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const KEY = 'dadis-map:voice-corner';
const readCorner = (): Corner => { try { const c = localStorage.getItem(KEY); return c === 'tl' || c === 'bl' || c === 'br' ? c : 'tr'; } catch { return 'tr'; } };

/** The voice on/off button, on every screen. Drag it to whichever corner suits; it stays there. */
export function VoiceButton() {
  const muted = useMuted(), t = useT();
  const [corner, setCorner] = useState<Corner>(readCorner);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current; if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) return;
    s.moved = true; setDrag({ x: e.clientX, y: e.clientY });
  };
  const up = (e: React.PointerEvent) => {
    const s = start.current; start.current = null;
    if (!s) return;
    if (!s.moved) { setMuted(!muted); return; }
    // snap to the nearest corner
    const c: Corner = ((e.clientY < innerHeight / 2 ? 't' : 'b') + (e.clientX < innerWidth / 2 ? 'l' : 'r')) as Corner;
    setCorner(c); setDrag(null);
    try { localStorage.setItem(KEY, c); } catch { /* not remembered */ }
  };

  const label = t(muted ? 'Turn the voice on' : 'Mute the voice');
  return (
    <button
      className={'voice-btn ' + (drag ? 'dragging' : corner) + (muted ? ' muted' : '')}
      style={drag ? { left: drag.x - 34, top: drag.y - 34 } : undefined}
      aria-label={label} title={label} aria-pressed={muted}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(null); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMuted(!muted); } }}
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13 H11 L18 7 V27 L11 21 H5 Z" fill="currentColor" />
        {muted
          ? <><path d="M23 13 L30 20" /><path d="M30 13 L23 20" /></>
          : <><path d="M23 12 Q27 17 23 22" /><path d="M26.5 8.5 Q33 17 26.5 25.5" /></>}
      </svg>
    </button>
  );
}
