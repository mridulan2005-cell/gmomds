import { useMemo, useState } from 'react';
import type { Go } from '../App';
import { Chevron, Dock, ScanPhoto, type Dest } from '../components';
import { DADI, CHILD } from '../lib/content';
import { useApp } from '../lib/store';
import type { Pair, Place } from '../lib/types';

interface Page { place: Place; month: string; pairs: { pair: Pair; day: number }[] }

export function Scrapbook({ go, dest, placeId }: { go: Go; dest: (d: Dest) => void; placeId?: string }) {
  const s = useApp();
  // oldest first; three entries per page, grouped by place
  const pages = useMemo(() => {
    const out: Page[] = [];
    [...s.months].reverse().forEach(m => m.places.forEach(p => {
      for (let k = 0; k < p.pairs.length; k += 3) out.push({ place: p, month: m.name, pairs: p.pairs.slice(k, k + 3).map((pair, i) => ({ pair, day: k + i + 1 })) });
    }));
    return out;
  }, [s.months]);
  const start = placeId ? Math.max(0, pages.findIndex(p => p.place.id === placeId)) : pages.length - 1; // opens on the newest page
  const [page, setPage] = useState(start);
  const pg = pages[Math.min(page, pages.length - 1)];
  const rots = [-1.5, 1, -0.5];

  return (
    <div className="screen book">
      <div className="book-head">
        <div className="book-title">OUR SCRAPBOOK</div>
        <div className="book-tags">
          {pg && <div className="tag">{(pg.place.status === 'done' ? pg.place.name : "This week's place") + ' · ' + pg.month}</div>}
          <div className="tag legend">
            <span style={{ color: DADI }}><i style={{ background: DADI }} />{s.names.dadi}</span>
            <span style={{ color: '#C8431E' }}><i style={{ background: CHILD }} />{s.names.child}</span>
          </div>
        </div>
      </div>
      <div className="book-page">
        {!pg && <div className="empty-book">Your drawings will be kept here. Scan today's pair to start the scrapbook.</div>}
        {pg && pg.pairs.map(({ pair, day }, k) => {
          const a = s.drawings[pair.dadi], b = s.drawings[pair.child];
          return (
            <div key={pair.promptId} className="entry" style={{ rotate: rots[k] + 'deg' }}>
              <div className="entry-pair">{a && <ScanPhoto d={a} rot={-3} />}{b && <ScanPhoto d={b} rot={3} />}</div>
              <div className="note">
                <img src="/paper-note.png" alt="" />
                <div className="note-text"><div className="d">Day {day}</div><div className="p">{pair.prompt}</div></div>
              </div>
            </div>
          );
        })}
      </div>
      {pages.length > 1 && (
        <>
          <button className="btn-round page-nav" style={{ left: 20, opacity: page > 0 ? 1 : 0.35 }} aria-label="Previous page" onClick={() => page > 0 && setPage(page - 1)}><Chevron dir="l" /></button>
          <button className="btn-round page-nav" style={{ right: 20, opacity: page < pages.length - 1 ? 1 : 0.35 }} aria-label="Next page" onClick={() => page < pages.length - 1 && setPage(page + 1)}><Chevron dir="r" /></button>
          <div className="page-label">Page {Math.min(page, pages.length - 1) + 1} of {pages.length}</div>
        </>
      )}
      <Dock items={['home', 'map']} go={dest} />
    </div>
  );
}
