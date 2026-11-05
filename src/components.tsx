import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapScene, type MapConfig, type Pick, type Pov } from './map/MapScene';
import { artUrl, promptDone, scanUrl, useApp } from './lib/store';
import type { Drawing } from './lib/types';
import { inkOf } from './lib/content';

import { Arrow, BookIcon, Chevron, MapIcon, TodayIcon } from './icons';
export { Arrow, Chevron };

export type Dest = 'home' | 'map' | 'book';
export function Dock({ items, go, point }: { items: Dest[]; go: (d: Dest) => void; point?: Dest }) {
  // today's prompt stands out while it is still waiting to be drawn
  const s = useApp(), todo = !!s.prompt && !promptDone(s);
  const meta: Record<Dest, [string, ReactNode]> = { home: ["Today's prompt", <TodayIcon />], map: ['Map', <MapIcon />], book: ['Scrapbook', <BookIcon />] };
  return (
    <div className="dock">
      {items.map((d, i) => (
        <span key={d} className="dock-slot">
          {/* a hand-drawn red arrow nudging them towards this button */}
          {point === d && <img className="dock-arrow" src={import.meta.env.BASE_URL + 'art/arrow.png'} alt="" aria-hidden="true" draggable={false} />}
          <button className={'btn-cream' + (d === 'home' && todo ? ' cta' : '')} style={{ rotate: i ? '1deg' : '-1deg' }} onClick={() => go(d)}>{meta[d][1]}{meta[d][0]}</button>
        </span>
      ))}
    </div>
  );
}

export function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="btn-cream back" onClick={onClick}><Chevron dir="l" size={24} />{label}</button>;
}

export function Perforation({ color }: { color?: string }) {
  const style = color ? ({ '--perf': color } as React.CSSProperties) : undefined;
  return <>{['t', 'b', 'l', 'r'].map(k => <div key={k} className={'perf ' + k} style={style} />)}</>;
}

/** The traced drawing: puffy regions in their colour, lines in the owner's ink. */
export function DrawingSvg({ d, size = 190 }: { d: Drawing; size?: number }) {
  const ink = inkOf(d.personId);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-label={d.label}>
      {d.paths.f.map((p, i) => <path key={'f' + i} d={p} fill={(d.paths.fc && d.paths.fc[i]) || d.fillColor} fillOpacity=".6" stroke={ink} strokeWidth="2.6" />)}
      {d.paths.s.map((p, i) => <path key={'s' + i} d={p} stroke={ink} strokeWidth="2.6" />)}
    </svg>
  );
}

/** The drawing exactly as it was drawn (paper made white); falls back to the traced lines for sample data. */
export function DrawingArt({ d, size = 190 }: { d: Drawing; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (d.hasArt) artUrl(d.id).then(u => on && setUrl(u)); return () => { on = false; }; }, [d.id, d.hasArt]);
  if (!d.hasArt) return <DrawingSvg d={d} size={size} />;
  return url ? <img src={url} alt={d.label} style={{ maxWidth: size, maxHeight: size, objectFit: 'contain', background: '#fff', borderRadius: 6, boxShadow: '0 3px 10px rgba(61,43,34,.12)' }} /> : <div style={{ width: size, height: size }} />;
}

/** The real paper scan for the scrapbook; falls back to the traced drawing (sample data has no scan). */
export function ScanPhoto({ d, rot }: { d: Drawing; rot: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; scanUrl(d.id).then(u => on && setUrl(u)); return () => { on = false; }; }, [d.id]);
  return (
    <div className="photo" style={{ rotate: rot + 'deg', borderBottomColor: inkOf(d.personId) }}>
      {url ? <img src={url} alt={d.label} /> : <DrawingSvg d={d} size={120} />}
    </div>
  );
}

export function Map3D({ config, onPick, reducedMotion, pov = null, onPov }: { config: MapConfig; onPick?: (p: Pick) => void; reducedMotion: boolean; pov?: Pov; onPov?: (who: Pov) => void }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<MapScene | null>(null), pickRef = useRef(onPick), povRef = useRef(onPov);
  const [failed, setFailed] = useState(false);
  pickRef.current = onPick; povRef.current = onPov;
  useEffect(() => {
    try {
      const s = new MapScene(host.current!); scene.current = s; s.artLoader = artUrl; s.onPick = p => pickRef.current?.(p); s.onPov = w => povRef.current?.(w);
    } catch (e) { console.error(e); setFailed(true); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { const s = scene.current; if (!s) return; s.reducedMotion = reducedMotion; s.setConfig(config); }, [config, reducedMotion]);
  useEffect(() => { scene.current?.setPov(pov, true); }, [pov]);
  return <div ref={host} className="map-canvas">{failed && <div className="loading3d">3D isn't available on this device.</div>}</div>;
}

/** Hand-drawn birds flying across the sky, behind everything else. */
export function SkyBirds() {
  const b = import.meta.env.BASE_URL + 'scenery/';
  return (
    <div className="sky-birds" aria-hidden="true">
      <img src={b + 'bird-green.png'} alt="" style={{ top: '16%', width: 150, animationDuration: '46s, 2.6s', animationDelay: '-8s, 0s' }} />
      <img src={b + 'birds-pair.png'} alt="" style={{ top: '30%', width: 230, animationDuration: '62s, 3.1s', animationDelay: '-36s, -1s', scale: '-1 1' }} />
    </div>
  );
}
export const Cloud = ({ style, fill = '#CDEDEA', w = 190 }: { style: React.CSSProperties; fill?: string; w?: number }) => (
  <svg width={w} height={(w * 70) / 190} viewBox="0 0 190 70" style={{ position: 'absolute', ...style }}><path d="M30 68 Q0 68 4 46 Q8 26 34 30 Q40 6 70 8 Q96 10 104 30 Q124 16 146 28 Q166 22 178 42 Q192 68 160 68 Z" fill={fill} /></svg>
);
export const Sun = () => (
  <svg width="300" height="300" viewBox="-150 -150 300 300" style={{ position: 'absolute', right: -80, top: -90 }}>
    <g style={{ animation: 'spin 80s linear infinite' }}><path d="M0 -150 L22 -88 L-22 -88 Z M150 0 L88 22 L88 -22 Z M0 150 L-22 88 L22 88 Z M-150 0 L-88 -22 L-88 22 Z M106 -106 L78 -46 L46 -78 Z M106 106 L46 78 L78 46 Z M-106 106 L-78 46 L-46 78 Z M-106 -106 L-46 -78 L-78 -46 Z" fill="#F5A623" /></g>
    <circle r="80" fill="#FFC93C" />
  </svg>
);
export const Dots = ({ d, stroke, style }: { d: string; stroke: string; style: React.CSSProperties }) => (
  <svg width="300" height="200" viewBox="0 0 300 200" style={{ position: 'absolute', ...style }} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" strokeDasharray="0 18"><path d={d} /></svg>
);
