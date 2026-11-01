import type { Go } from '../App';
import { Arrow, DrawingArt, Perforation } from '../components';
import { DADI, CHILD } from '../lib/content';
import { useApp } from '../lib/store';

export function Sketches({ go }: { go: Go }) {
  const s = useApp();
  // the newest pair on the map
  const place = s.months[0].places.find(p => p.id === s.lastFresh?.placeId) || s.months[0].places.find(p => p.status === 'current');
  const pair = place?.pairs[place.pairs.length - 1];
  const a = pair && s.drawings[pair.dadi], b = pair && s.drawings[pair.child];
  const cards = [
    a && { d: a, owner: s.names.dadi, color: DADI, tint: '#C9D8F7', r: -3, delay: '0s' },
    b && { d: b, owner: s.names.child, color: CHILD, tint: '#F9CDBB', r: 2.5, delay: '.5s' },
  ].filter(Boolean) as { d: NonNullable<typeof a>; owner: string; color: string; tint: string; r: number; delay: string }[];
  return (
    <div className="screen sketches">
      <div className="giant" style={{ top: 'calc(10px + env(safe-area-inset-top) / var(--scale))' }}>TODAY'S</div>
      <div className="giant" style={{ bottom: 'calc(180px + env(safe-area-inset-bottom) / var(--scale))' }}>SKETCHES</div>
      <svg width="260" height="160" viewBox="0 0 260 160" style={{ position: 'absolute', left: 40, top: '32%' }} fill="none" stroke="#F5C84C" strokeWidth="7" strokeLinecap="round" strokeDasharray="0 18"><path d="M10 20 Q60 120 120 60 T250 140" /></svg>
      <div className="stamps">
        {cards.map(c => (
          <div key={c.d.id} className="stamp" style={{ rotate: c.r + 'deg', animationDelay: c.delay }}>
            <Perforation color="#E9A3C0" />
            <div className="stamp-inner" style={{ background: c.tint }}><DrawingArt d={c.d} /></div>
            <div className="stamp-owner" style={{ color: c.color }}><span>{c.owner}</span><small>{c.d.label}</small></div>
            {c.d.source !== 'sample' && <button className="btn-cream small stamp-retake" onClick={() => go({ screen: 'scan', who: c.d.personId, replace: c.d.id })}>Retake</button>}
          </div>
        ))}
      </div>
      <div className="place-btn"><button className="btn-primary" onClick={() => go(place ? { screen: 'place', placeId: place.id } : { screen: 'home' })}><Arrow />Show on map</button></div>
    </div>
  );
}
