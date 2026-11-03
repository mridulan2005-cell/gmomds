import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App';
import { Chevron, Dock, DrawingSvg, type Dest } from '../components';
import { DADI, CHILD } from '../lib/content';
import { scanUrl, useApp } from '../lib/store';
import type { Drawing, Pair, Place } from '../lib/types';

// A place gets a title page, then day pages of up to three pairs; pages are padded so each place starts on a left page.
type PageData =
  | { kind: 'title'; place: Place; month: string; week: number }
  | { kind: 'days'; head: string; first: number; rows: { pair: Pair; day: number }[] }
  | { kind: 'blank' };
interface Spread { placeId: string; l: PageData; r: PageData }

// The book is laid out at this size and scaled to fit the screen.
const BW = 1168, BH = 680, FLIP_MS = 820;
const rings = Array.from({ length: 15 }, (_, i) => 12 + i * 38.5);
const tape = (c: string) => `repeating-linear-gradient(45deg, ${c}73 0 6px, ${c}40 6px 12px)`;

/** The real paper scan when there is one, else the traced drawing. */
function Snap({ d }: { d: Drawing }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; scanUrl(d.id).then(u => on && setUrl(u)); return () => { on = false; }; }, [d.id]);
  return url ? <img src={url} alt={d.label} /> : <DrawingSvg d={d} size={96} />;
}

function PageView({ p, side, num, anim, onClick }: { p: PageData; side: 'l' | 'r'; num: number; anim?: string; onClick: () => void }) {
  const s = useApp();
  return (
    <div className={'sb-page ' + side} style={{ animation: anim }} onClick={onClick}>
      <div className="sb-gutter" />
      {p.kind === 'title' && (
        <div className="sb-title">
          <div className="sb-when">{p.month} · Week {p.week}</div>
          <div className="sb-place">{p.place.status === 'done' ? p.place.name : 'A surprise place'}</div>
          <svg width="230" height="18" viewBox="0 0 230 18" fill="none"><path d="M4 12 C40 2 70 16 110 8 S190 4 226 10" stroke="#F26A2E" strokeWidth="5" strokeLinecap="round" /></svg>
          <div className="sb-faces">
            {([['dadi', DADI, -4, -3], ['child', CHILD, 3, 4]] as const).map(([who, c, r, tr]) => (
              <div key={who} className="sb-face" style={{ rotate: r + 'deg' }}>
                <div className="sb-tape" style={{ background: tape(c), rotate: tr + 'deg' }} />
                <div role="img" aria-label={s.names[who]} className="sb-face-img" style={{ backgroundColor: who === 'dadi' ? '#FDF0EA' : '#EEF2FC', backgroundImage: `url(${s.faces[who]})` }} />
                <div className="sb-who" style={{ color: c }}>{s.names[who]}</div>
              </div>
            ))}
          </div>
          {p.place.status !== 'done' && <div className="sb-mystery">Day 7 tells us where we are.</div>}
        </div>
      )}
      {p.kind === 'days' && (
        <>
          <div className="sb-head">
            <div className="sb-days">{p.rows.length > 1 ? `Days ${p.first}–${p.first + p.rows.length - 1}` : `Day ${p.first}`}</div>
            <div className="sb-head-r">{p.head}</div>
          </div>
          <div className="sb-rows">
            {p.rows.map(({ pair, day }) => (
              <div key={pair.promptId} className="sb-row">
                <div className="sb-prompt">
                  <img src="/paper-note.png" alt="" />
                  <div className="sb-note">
                    <div className="sb-day">Day {day}</div>
                    <div className="sb-text">{pair.prompt}</div>
                  </div>
                </div>
                <div className="sb-pair">
                  {([['dadi', DADI, -4, -3], ['child', CHILD, 3, 4]] as const).map(([who, c, r, tr]) => {
                    const d = s.drawings[pair[who]];
                    return (
                      <div key={who} className="sb-snap" style={{ rotate: r + 'deg' }}>
                        <div className="sb-tape small" style={{ background: tape(who === 'dadi' ? '#2F5FD0' : '#F26A2E'), rotate: tr + 'deg' }} />
                        <div className="sb-snap-img">{d && <Snap d={d} />}</div>
                        <div className="sb-who small" style={{ color: c }}>{s.names[who]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {p.kind !== 'blank' && <div className={'sb-num ' + side}>{num}</div>}
    </div>
  );
}

export function Scrapbook({ dest, placeId }: { go: Go; dest: (d: Dest) => void; placeId?: string }) {
  const s = useApp();
  // oldest first
  const spreads = useMemo(() => {
    const out: Spread[] = [];
    [...s.months].reverse().forEach(m => m.places.forEach((p, pi) => {
      if (!p.pairs.length) return;
      const head = m.name + ' · ' + (p.status === 'done' ? p.name : 'This week');
      const pages: PageData[] = [{ kind: 'title', place: p, month: m.name, week: pi + 1 }];
      for (let k = 0; k < p.pairs.length; k += 3) pages.push({ kind: 'days', head, first: k + 1, rows: p.pairs.slice(k, k + 3).map((pair, i) => ({ pair, day: k + i + 1 })) });
      if (pages.length % 2) pages.push({ kind: 'blank' });
      for (let k = 0; k < pages.length; k += 2) out.push({ placeId: p.id, l: pages[k], r: pages[k + 1] });
    }));
    if (!out.length) out.push({ placeId: '', l: { kind: 'blank' }, r: { kind: 'blank' } });
    return out;
  }, [s.months]);
  const last = spreads.length - 1;

  const [page, setPage] = useState(() => {
    const i = placeId ? spreads.findIndex(sp => sp.placeId === placeId) : -1;
    return i >= 0 ? i : last; // opens on the newest spread
  });
  const cur = Math.min(page, last);
  const [flip, setFlip] = useState<{ from: number; to: number } | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const sound = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { const a = new Audio(import.meta.env.BASE_URL + 'page-flip.mp3'); a.preload = 'auto'; sound.current = a; }, []);

  const flipTo = (to: number) => {
    if (flip || to < 0 || to > last) return;
    const a = sound.current;
    if (a) { a.currentTime = 0; void a.play().catch(() => {}); }
    setFlip({ from: cur, to });
    setPage(to);
    timer.current = window.setTimeout(() => setFlip(null), FLIP_MS);
  };
  const prev = () => flipTo(cur - 1), next = () => flipTo(cur + 1);

  // scale the book to the space it has
  const area = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    const el = area.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setK(Math.min(e.contentRect.width / BW, e.contentRect.height / BH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = (pg: PageData, side: 'l' | 'r', si: number, anim?: string) => (
    <PageView key={side + si + (anim || '')} p={pg} side={side} num={si * 2 + (side === 'l' ? 1 : 2)} anim={anim} onClick={side === 'l' ? prev : next} />
  );
  let pages;
  if (flip) {
    const A = spreads[flip.from], B = spreads[flip.to];
    pages = flip.to > flip.from
      ? [view(A.l, 'l', flip.from), view(B.r, 'r', flip.to), view(A.r, 'r', flip.from, 'bkUpR .4s ease-in both'), view(B.l, 'l', flip.to, 'bkDownL .4s .4s ease-out both')]
      : [view(B.l, 'l', flip.to), view(A.r, 'r', flip.from), view(A.l, 'l', flip.from, 'bkUpL .4s ease-in both'), view(B.r, 'r', flip.to, 'bkDownR .4s .4s ease-out both')];
  } else pages = [view(spreads[cur].l, 'l', cur), view(spreads[cur].r, 'r', cur)];

  const swipe = useRef<number | null>(null);
  return (
    <div className="screen book">
      <div className="book-area" ref={area}
        onPointerDown={e => { swipe.current = e.clientX; }}
        onPointerUp={e => { if (swipe.current !== null) { const dx = e.clientX - swipe.current; if (Math.abs(dx) > 50) dx < 0 ? next() : prev(); } swipe.current = null; }}>
        {k > 0 && (
          <div style={{ width: BW * k, height: BH * k, flex: 'none' }}>
            <div className="sb" style={{ width: BW, height: BH, scale: String(k) }}>
              <div className="sb-cover" />
              <div className="sb-stack l" />
              <div className="sb-stack r" />
              {pages}
              <div className="sb-rings">
                {rings.map(y => (
                  <div key={y} className="sb-ring" style={{ top: y }}><i /><i /><b /></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <button className="btn-round page-nav" style={{ left: 14, opacity: cur > 0 ? 1 : 0.35 }} aria-label="Previous page" onClick={prev}><Chevron dir="l" /></button>
      <button className="btn-round page-nav" style={{ right: 14, opacity: cur < last ? 1 : 0.35 }} aria-label="Next page" onClick={next}><Chevron dir="r" /></button>
      <Dock items={['home', 'map']} go={dest} />
    </div>
  );
}
