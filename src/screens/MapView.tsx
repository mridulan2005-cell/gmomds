import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion, type Go, type Route } from '../App';
import { Arrow, Back, Dock, Map3D, Cloud, type Dest } from '../components';
import { clearFresh, completePlace, currentPlace, getState, placeById, useApp } from '../lib/store';
import { placeCfg, stackCfg } from '../lib/mapConfig';
import type { MapConfig, Pick } from '../map/MapScene';
import { ORANGE, SUN } from '../lib/content';

type MapRoute = Extract<Route, { screen: 'stack' | 'interior' | 'place' | 'reveal' }>;

export function MapView({ route, go, dest }: { route: MapRoute; go: Go; dest: (d: Dest) => void }) {
  const s = useApp(), reduced = useReducedMotion();
  // the newest pair rises out of the island once, the first time its place is opened
  const [fresh] = useState(() => (route.screen === 'place' && s.lastFresh?.placeId === route.placeId ? s.lastFresh.slot : -1));
  useEffect(() => () => { if (route.screen === 'place') clearFresh(); }, []);

  // reveal: ghost → solid colour, then the name, then the button
  const [stage, setStage] = useState(0);
  const [revealPlace] = useState(() => (route.screen === 'reveal' ? currentPlace(getState()) : undefined));
  useEffect(() => {
    if (route.screen !== 'reveal') return;
    if (!revealPlace || revealPlace.pairs.length < 7) { go({ screen: 'home' }); return; }
    const ts = [setTimeout(() => setStage(1), 400), setTimeout(() => setStage(2), reduced ? 1200 : 3200), setTimeout(() => setStage(3), reduced ? 1800 : 4600)];
    return () => ts.forEach(clearTimeout);
  }, []);

  let cfg: MapConfig | null = null, title = '', hint = '', back: { label: string; to: Route } | null = null;
  let stepper: { n: number; fresh: boolean; done: boolean } | null = null, action: { label: string; run: () => void } | null = null, bookBtn: string | null = null;

  if (route.screen === 'stack') {
    cfg = { mode: 'stack', key: 'stack', months: stackCfg(s) };
    title = s.months.length > 1 ? 'All our maps' : 'Our map'; hint = s.months.length > 1 ? 'Scroll or drag to look through · tap a map to go inside' : 'Tap the map to go inside';
  } else if (route.screen === 'interior') {
    const m = s.months[route.mi] || s.months[0];
    cfg = { mode: 'month', key: 'month-' + m.id, places: m.places.map(p => placeCfg(s, p)), kind: m.name };
    title = m.name + (route.mi === 0 ? ' · in progress' : ''); hint = 'Drag to move around · two fingers to turn · tap a place to visit it';
    back = { label: 'All maps', to: { screen: 'stack' } };
  } else if (route.screen === 'place') {
    const hit = placeById(s, route.placeId);
    if (hit) {
      const { place, mi } = hit, n = place.pairs.length, done = place.status === 'done';
      cfg = { mode: 'place', key: place.id, place: placeCfg(s, place), fresh };
      title = done ? place.name : 'Theme: ???'; hint = done ? 'Drag to move around · two fingers to turn' : 'Drag to move around · two fingers to turn · the theme appears after seven pairs';
      back = { label: 'Map', to: { screen: 'interior', mi } };
      stepper = { n, fresh: fresh >= 0, done };
      if (done) bookBtn = place.id;
      if (!done && n >= 7 && place.status === 'current') action = { label: 'See what we made', run: () => go({ screen: 'reveal' }) };
    }
  } else if (route.screen === 'reveal' && revealPlace) {
    const p = { ...revealPlace }, solid = stage >= 1;
    cfg = { mode: 'place', key: 'reveal', place: placeCfg(s, p, solid ? 'done' : 'current'), fade: solid };
    title = stage >= 2 ? `This is your ${p.name.replace(/^The /, '')}!` : 'Theme: ???';
    hint = stage >= 2 ? 'Seven drawings, one place' : '';
    if (stage >= 2) stepper = { n: 7, fresh: false, done: true };
    if (stage >= 3) action = {
      label: 'See our map', run: () => {
        const monthId = getState().months.find(m => m.places.some(x => x.id === p.id))?.id;
        completePlace();
        const mi = Math.max(0, getState().months.findIndex(m => m.id === monthId));
        go({ screen: 'interior', mi });
      },
    };
  }

  // the caricatures they drew of each other walk around the finished places
  if (cfg) cfg = { ...cfg, walkers: { d: s.faces.dadi, a: s.faces.child } };

  const onPick = useMemo(() => (pk: Pick) => {
    const st = getState();
    if (pk.type === 'month') go({ screen: 'interior', mi: pk.mi });
    else if (route.screen === 'interior') { const m = st.months[route.mi]; const pl = m?.places[pk.pi]; if (pl && pl.status !== 'locked') go({ screen: 'place', placeId: pl.id }); }
  }, [route]);

  const showDock = route.screen !== 'reveal' && !action;
  return (
    <div className="screen mapbg">
      <Cloud fill="#E6F6F3" style={{ left: 60, top: 110, animation: 'drift 45s ease-in-out infinite alternate' }} />
      <Cloud fill="#E6F6F3" w={240} style={{ right: 140, top: 150, animation: 'drift 60s ease-in-out infinite alternate-reverse' }} />
      {cfg && <Map3D config={cfg} onPick={onPick} reducedMotion={reduced} />}
      <div className="map-title"><div className="t">{title}</div>{hint && <div className="h">{hint}</div>}</div>
      {stepper && (
        <div className="stepper-card">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {Array.from({ length: 7 }, (_, k) => {
              const filled = k < stepper!.n, newest = stepper!.fresh && k === stepper!.n - 1;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center' }}>
                  {k > 0 && <div className="step-line" />}
                  <div className="step-dot" style={{ background: newest ? SUN : filled ? ORANGE : 'transparent', boxShadow: `inset 0 0 0 3px ${filled ? 'transparent' : 'rgba(61,43,34,.3)'}` }} />
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{stepper.done || stepper.n >= 7 ? 'All seven done' : 7 - stepper.n === 1 ? '1 more to go' : `${7 - stepper.n} more to go`}</div>
          {bookBtn && <button className="btn-primary" style={{ height: 46, padding: '0 18px', fontSize: 17, boxShadow: '0 5px 0 #B9481B', rotate: '0deg' }} onClick={() => go({ screen: 'book', placeId: bookBtn! })}>In our scrapbook</button>}
        </div>
      )}
      {action && <div className="place-btn"><button className="btn-primary" style={{ height: 84, fontSize: 30 }} onClick={action.run}><Arrow />{action.label}</button></div>}
      {back && <Back label={back.label} onClick={() => go(back!.to)} />}
      {showDock && <Dock items={['home', 'book']} go={dest} />}
    </div>
  );
}
