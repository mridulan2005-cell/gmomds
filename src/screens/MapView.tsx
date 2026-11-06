import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion, type Go, type Route } from '../App';
import { Arrow, Back, Dock, Map3D, Cloud, SkyBirds, type Dest } from '../components';
import { CloseIcon, MapIcon } from '../icons';
import { awaitingPin, clearFresh, completePlace, currentPlace, getState, placeById, placeTotal, reachPin, useApp } from '../lib/store';
import { dreamCfg, placeCfg, stackCfg } from '../lib/mapConfig';
import type { DreamFocus, MapConfig, Pick, Pov, RoomKey } from '../map/MapScene';
import { BUILD_NOTES, ORANGE, ROOM_NOTES, SUN } from '../lib/content';
import { noteIn, useT } from '../lib/i18n';
import { say, useSay } from '../lib/voice';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];

type MapRoute = Extract<Route, { screen: 'stack' | 'interior' | 'place' | 'reveal' }>;

/** A map made of one place (the Welcome Party) is that place itself: going into the map opens the place. */
const soloPlace = (s: ReturnType<typeof getState>, mi: number) => { const m = s.months[mi] || s.months[0]; return !m.dream && m.places.length === 1 ? m.places[0] : null; };

export function MapView({ route: route0, go, dest }: { route: MapRoute; go: Go; dest: (d: Dest) => void }) {
  const s = useApp(), reduced = useReducedMotion(), t = useT();
  const [route] = useState<MapRoute>(() => { const solo = route0.screen === 'interior' ? soloPlace(s, route0.mi) : null; return solo ? { screen: 'place', placeId: solo.id } : route0; });
  // the newest pair rises out of the island once, the first time its place is opened
  const [fresh] = useState(() => (route.screen === 'place' && s.lastFresh?.placeId === route.placeId ? s.lastFresh.slot : -1));
  useEffect(() => () => { if (route.screen === 'place') clearFresh(); }, []);
  // ...and the bit of the place it builds gets a little note, once the new scenery has grown in
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const hit = route.screen === 'place' && fresh >= 0 ? placeById(s, route.placeId) : undefined;
    // the notes follow the place's four building stages (a place with fewer prompts builds more at a time)
    const T = hit ? placeTotal(hit.place) : 4, st = fresh + 1 >= T ? 4 : Math.round(((fresh + 1) * 4) / T);
    const room = hit?.place.room, en = room ? ROOM_NOTES[room]?.[fresh] : hit && hit.place.status === 'current' ? BUILD_NOTES[hit.place.theme]?.[st - 1] : undefined;
    const text = en && noteIn(t.lang, room || hit!.place.theme, room ? fresh : st - 1, en);
    if (!text) return;
    const late = room === 'house' ? 4000 : 0;
    const ts = [setTimeout(() => setNote(text), (reduced ? 300 : 2700) + late), setTimeout(() => setNote(null), (reduced ? 6300 : 8700) + late)];
    return () => ts.forEach(clearTimeout);
  }, []);

  // reveal: ghost → solid colour, then the name, then the button
  const [stage, setStage] = useState(0);
  // whose eyes the map is seen through (null: from above)
  const [pov, setPov] = useState<Pov>(null);
  // the Dream House: lift the roof off to look into the rooms
  const [peek, setPeek] = useState(false);
  const [revealPlace] = useState(() => (route.screen === 'reveal' ? currentPlace(getState()) : undefined));
  useEffect(() => {
    if (route.screen !== 'reveal') return;
    if (!revealPlace || revealPlace.pairs.length < placeTotal(revealPlace)) { go({ screen: 'home' }); return; }
    const ts = [setTimeout(() => setStage(1), 400), setTimeout(() => setStage(2), reduced ? 1200 : 3200), setTimeout(() => setStage(3), reduced ? 1800 : 4600)];
    return () => ts.forEach(clearTimeout);
  }, []);

  let cfg: MapConfig | null = null, title = '', hint = '', back: { label: string; to: Route } | null = null;
  let stepper: { n: number; total: number; fresh: boolean; done: boolean } | null = null, freshLast = false, action: { label: string; run: () => void } | null = null, bookBtn: string | null = null;
  let peekBtn = false, revealDelay = 4800, voice: string | null = null, excited = false;

  if (route.screen === 'stack') {
    cfg = { mode: 'stack', key: 'stack', months: stackCfg(s) };
    title = t(s.months.length > 1 ? 'All our maps' : 'Our map'); hint = t(s.months.length > 1 ? 'Scroll or drag to look through · tap a map to go inside' : 'Tap the map to go inside');
    voice = t('Here are all your maps. Tap a map to go inside.');
  } else if (route.screen === 'interior') {
    const m = s.months[route.mi] || s.months[0];
    cfg = m.dream ? { mode: 'dream', key: 'dream-' + m.id, dream: dreamCfg(s, m), focus: 'all', peek } : { mode: 'month', key: 'month-' + m.id, places: m.places.map(p => placeCfg(s, p)), kind: m.name };
    if (m.dream && m.places.some(p => p.room === 'house' && p.status === 'done')) peekBtn = true;
    // a map they have only just moved on to: nothing is drawn on it yet
    const fresh0 = route.mi === 0 && s.months.length > 1 && m.places.every(p => !p.pairs.length && p.status !== 'done');
    if (fresh0) {
      title = t('Next up: {name}', { name: t(m.name) });
      hint = t(m.places.length === 1 ? '{w} place to build · tap Today’s doodle to begin' : '{w} places to build · tap Today’s doodle to begin', { w: WORDS[m.places.length] || m.places.length, n: m.places.length });
      voice = t("Next up: {name}! Tap Today's doodle to begin.", { name: t(m.name) });
    } else if (route.mi === 0 && awaitingPin(s)) {
      // the map has come alive: a pin at its edge waits to be walked to
      title = t(m.name); hint = t('Press Play and follow the light to the pin');
      voice = t('Your map has come alive! Press Play and follow the light to the red pin.'); excited = true;
    } else {
      title = t(m.name) + (route.mi === 0 && m.places.some(p => p.status !== 'done') ? t(' · in progress') : ''); hint = t('Drag to move around · two fingers to turn · tap a ' + (m.dream ? 'room' : 'place') + ' to visit it');
      voice = t('Here is {name}. Drag to look around, or press Play to walk inside.', { name: t(m.name) });
    }
    back = { label: 'All maps', to: { screen: 'stack' } };
  } else if (route.screen === 'place') {
    const hit = placeById(s, route.placeId);
    if (hit) {
      const { place, mi } = hit, n = place.pairs.length, done = place.status === 'done', total = placeTotal(place);
      const m = s.months[mi];
      cfg = m.dream && place.room
        ? { mode: 'dream', key: place.id, dream: dreamCfg(s, m), focus: place.room as DreamFocus, fresh: fresh >= 0 ? { room: place.room as RoomKey | 'house', i: fresh } : null, peek }
        : { mode: 'place', key: place.id, place: placeCfg(s, place), fresh };
      if (m.dream && m.places.some(p => p.room === 'house' && p.status === 'done') && fresh < 0) peekBtn = true;
      // the place's name stays a mystery until its last drawing goes in (a one-place map is named already: it is the map)
      const solo = m.places.length === 1 && !m.dream;
      // the last drawing has just gone in: the place reveals itself on its own
      freshLast = fresh >= 0 && place.status === 'current' && n >= total;
      // (the last pair of a one-place map goes straight on to its completion, with no "in progress" in between)
      title = freshLast ? t('The last drawing goes in…') : solo ? t(m.name) + (done ? '' : t(' · in progress')) : done ? t(place.name) : '???';
      const pinNext = place.room === 'bridge' && awaitingPin(s);
      hint = freshLast ? '' : !done && n === 0 ? (pinNext ? t('Press Play and follow the light to the pin') : t('Next up in {name} · tap Today’s doodle to begin', { name: t(m.name) })) : t('Drag to move around · two fingers to turn');
      voice = freshLast || fresh >= 0 ? null : !done && n === 0 ? (pinNext ? t('Follow the light to the red pin.') : t("Next up in {name}. Tap Today's doodle to begin.", { name: t(m.name) }))
        : t('Here is {name}. Drag to look around, or press Play to walk inside.', { name: done ? t(place.name) : solo ? t(m.name) : '???' });
      back = solo ? { label: 'All maps', to: { screen: 'stack' } } : { label: 'Map', to: { screen: 'interior', mi } };
      stepper = { n, total, fresh: fresh >= 0, done };
      if (done) bookBtn = place.id;
      // the house is still being built (front, walls, roof, door) before it reveals itself
      if (freshLast && place.room === 'house') revealDelay = 7600;
      if (freshLast) { voice = t('Here comes the last drawing!'); excited = true; }
      if (!done && !freshLast && n >= total && place.status === 'current') { action = { label: t('See what we made'), run: () => go({ screen: 'reveal' }) }; voice = t('Your place is ready! Tap See what we made.'); excited = true; }
    }
  } else if (route.screen === 'reveal' && revealPlace) {
    const p = { ...revealPlace }, solid = stage >= 1, m0 = getState().months[0];
    cfg = m0.dream && p.room
      // a room of the Dream House: it is shown finished; the last one makes the whole house come alive
      ? { mode: 'dream', key: 'reveal-' + (solid ? 1 : 0), dream: dreamCfg(s, m0, solid ? { placeId: p.id, status: 'done' } : undefined), focus: solid && (m0.places.at(-1)?.id === p.id || p.room === 'park') ? 'all' : (p.room as DreamFocus) }
      : { mode: 'place', key: 'reveal', place: placeCfg(s, p, solid ? 'done' : 'current'), fade: solid };
    title = stage >= 2 ? '' : t('The last drawing goes in…');
    if (stage >= 2) stepper = { n: placeTotal(p), total: placeTotal(p), fresh: false, done: true };
    const ps = getState().months[0].places, lastOfMap = ps.at(-1)?.id === p.id;
    // the Park finishes the Dream House: it comes alive, and the bridge waits behind the pin
    const toPin = ps[ps.findIndex(q => q.id === p.id) + 1]?.room === 'bridge';
    if (stage >= 3) action = {
      label: t(lastOfMap ? (p.room === 'bridge' ? 'Cross the bridge' : 'On to our next map') : toPin ? 'See our map' : 'On to the next place'), run: () => {
        completePlace();
        // straight to where they draw next: the next place, or the first place of the next map (or the map, to find the pin)
        const next = currentPlace(getState());
        go(next && !toPin ? { screen: 'place', placeId: next.id } : { screen: 'interior', mi: 0 });
      },
    };
  }

  // the caricatures they drew of each other walk around the places, finished or in progress
  if (cfg) cfg = { ...cfg, walkers: { d: s.faces.dadi, a: s.faces.child }, names: { d: s.names.dadi, a: s.names.child } };
  // ...and Play walks around the map in first person, as a third character (not while a new pair is rising out of the island)
  const povAvail = !peek && ((route.screen === 'place' && !!stepper && fresh < 0) || (route.screen === 'interior' && (s.months[route.mi] || s.months[0]).places.some(p => p.status !== 'locked' && (p.pairs.length > 0 || p.status === 'done'))));
  // walking up to the pin: the bridge to the next map becomes their last prompt
  const [pinCard, setPinCard] = useState(false);
  const onPin = () => { if (!awaitingPin(getState())) return; setPov(null); setPinCard(true); };
  const findPin = awaitingPin(s) && (route.screen === 'interior' ? route.mi === 0 : route.screen === 'place' && placeById(s, route.placeId)?.mi === 0);

  // tapping a padlock: how many more prompts until that place opens
  const [lockMsg, setLockMsg] = useState<{ text: string; k: number } | null>(null);
  useEffect(() => { if (!lockMsg) return; const t = setTimeout(() => setLockMsg(null), 3200); return () => clearTimeout(t); }, [lockMsg]);

  const onPick = useMemo(() => (pk: Pick) => {
    const st = getState();
    if (pk.type === 'lock') {
      const mi = pk.mi ?? (route.screen === 'interior' ? route.mi : 0), m = st.months[mi];
      const idx = m ? (pk.room ? m.places.findIndex(p => p.room === pk.room) : pk.pi ?? -1) : -1;
      if (idx < 0) return;
      const left = m.places.slice(0, idx).reduce((n, p) => n + (p.status === 'done' ? 0 : Math.max(0, placeTotal(p) - p.pairs.length)), 0);
      if (left > 0) { const text = t(left === 1 ? '{n} more prompt until you unlock this!' : '{n} more prompts until you unlock this!', { n: left }); setLockMsg(v => ({ text, k: (v?.k || 0) + 1 })); say(text, t.lang); }
      return;
    }
    if (pk.type === 'month') go({ screen: 'interior', mi: pk.mi });
    else if (route.screen === 'interior') {
      const m = st.months[route.mi], pl = pk.type === 'room' ? m?.places.find(p => p.room === pk.room) : m?.places[pk.pi];
      if (pl && pl.status !== 'locked') go({ screen: 'place', placeId: pl.id });
    }
  }, [route, t.lang]);

  useEffect(() => {
    if (!freshLast) return;
    const t = setTimeout(() => go({ screen: 'reveal' }), reduced ? 2500 : revealDelay);
    return () => clearTimeout(t);
  }, [freshLast]);

  const win = route.screen === 'reveal' && !!revealPlace && stage >= 2;
  // the "level complete" fanfare, once each time the win card pops up
  useEffect(() => {
    if (!win) return;
    const a = new Audio(import.meta.env.BASE_URL + 'level-complete.mp3');
    a.volume = 0.8;
    a.play().catch(() => {});
    return () => { a.pause(); };
  }, [win]);
  const winName0 = revealPlace && getState().months[0].places.at(-1)?.id === revealPlace.id && getState().months[0].places.length > 1 ? getState().months[0].name : revealPlace?.name;
  const winName = winName0 ? t(winName0) : '';
  if (win && winName) { voice = t(revealPlace!.room === 'house' ? 'Yay! {name} is built! Tap the orange button to go on.' : 'Yay! {name} is complete! Tap the orange button to go on.', { name: winName }); excited = true; }
  // the voice: this screen, the pin card, or walking around
  const findPin0 = findPin;
  useSay(pinCard ? t("You found the pin! Build a bridge to go to your next map. Tap Let's draw it.")
    : pov ? (findPin0 ? t('Follow the light to the red pin.') : t('Use the joystick to walk around. Tap a drawing, a flower, {a} or {b} to say hello.', { a: s.names.dadi, b: s.names.child }))
    : note || voice, t.lang, pinCard || (!pov && (!!note || excited)) ? 'excited' : 'warm');
  const showDock = route.screen !== 'reveal' && !action && !pov && !freshLast;
  // right after the Welcome Party, on the next map (nothing drawn on it yet), an arrow points them to Today's prompt
  const m0 = s.months[0], onM0 = route.screen === 'stack' || (route.screen === 'interior' ? route.mi === 0 : route.screen === 'place' && placeById(s, route.placeId)?.mi === 0);
  const pointPrompt = showDock && onM0 && s.months.length === 2 && m0.places.every(p => !p.pairs.length && p.status !== 'done');
  return (
    <div className="screen mapbg">
      <Cloud fill="#E6F6F3" style={{ left: 60, top: 110, animation: 'drift 45s ease-in-out infinite alternate' }} />
      <SkyBirds />
      <Cloud fill="#E6F6F3" w={240} style={{ right: 140, top: 150, animation: 'drift 60s ease-in-out infinite alternate-reverse' }} />
      {win && (
        <>
          <div className="win-burst" />
          <div className="win-rays" aria-hidden="true">
            <svg width="1500" height="1500" viewBox="-10 -10 20 20"><path d="M0 0 L9.91 1.31 L9.91 -1.31 Z M0 0 L7.93 6.09 L9.24 3.83 Z M0 0 L3.83 9.24 L6.09 7.93 Z M0 0 L-1.31 9.91 L1.31 9.91 Z M0 0 L-6.09 7.93 L-3.83 9.24 Z M0 0 L-9.24 3.83 L-7.93 6.09 Z M0 0 L-9.91 -1.31 L-9.91 1.31 Z M0 0 L-7.93 -6.09 L-9.24 -3.83 Z M0 0 L-3.83 -9.24 L-6.09 -7.93 Z M0 0 L1.31 -9.91 L-1.31 -9.91 Z M0 0 L6.09 -7.93 L3.83 -9.24 Z M0 0 L9.24 -3.83 L7.93 -6.09 Z" fill="#FFE66D" /></svg>
          </div>
        </>
      )}
      {cfg && <Map3D config={cfg} onPick={onPick} reducedMotion={reduced} pov={pov} onPov={setPov} onPin={onPin} />}
      {win && (
        <div className="win" role="status">
          <div className="win-pop"><div className="win-card"><div className="win-name">{winName}</div><div className="win-done">{t(revealPlace!.room === 'house' ? 'Built!' : 'Complete!')}</div></div></div>
        </div>
      )}
      {!pov && title && <div className="map-title"><div className="t">{title}</div>{hint && <div className="h">{hint}</div>}</div>}
      {note && !pov && <div className="build-note" role="status">{note}</div>}
      {lockMsg && !pov && !note && <div key={lockMsg.k} className="build-note lock-note" role="status">{lockMsg.text}</div>}
      {povAvail && !pov && !pinCard && (
        <button className={'play-btn' + (findPin ? ' glow' : '')} onClick={() => setPov('p')}><PlayGlyph />{t('Play')}</button>
      )}
      {pov && (
        <>
          <button className="btn-cream back" onClick={() => setPov(null)}><CloseIcon size={26} />{t('Exit')}</button>
          {findPin && <div className="pov-you pin-hint">{t('Follow the light to the pin!')}</div>}
          <div className="pov-help"><span>{t('Joystick to walk · drag to look around')}</span><span style={{ opacity: 0.65 }}>{t('Tap a drawing, a flower, {a} or {b}', { a: s.names.dadi, b: s.names.child })}</span></div>
        </>
      )}
      {pinCard && (
        <div className="sheet-bg pin-card-bg">
          <div className="sheet pin-card" role="dialog" aria-label={t('Last prompt')}>
            <img src={import.meta.env.BASE_URL + 'dream/pin_red.png'} alt="" aria-hidden="true" className="pin-card-pin" />
            <div className="pin-card-k">{t('Last prompt')}</div>
            <h2>{t('Build a bridge to go to your next map!')}</h2>
            <div className="row">
              <button className="btn-primary" onClick={() => { reachPin(); go({ screen: 'home' }); }}><Arrow />{t('Let’s draw it')}</button>
              <button className="btn-cream" onClick={() => setPinCard(false)}>{t('Keep exploring')}</button>
            </div>
          </div>
        </div>
      )}
      {stepper && !pov && (
        <div className="stepper-card">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {Array.from({ length: stepper.total }, (_, k) => {
              const filled = k < stepper!.n, newest = stepper!.fresh && k === stepper!.n - 1;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center' }}>
                  {k > 0 && <div className="step-line" />}
                  <div className="step-dot" style={{ background: newest ? SUN : filled ? ORANGE : 'transparent', boxShadow: `inset 0 0 0 3px ${filled ? 'transparent' : 'rgba(61,43,34,.3)'}` }} />
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{stepper.done ? stepper.total : Math.min(stepper.n, stepper.total)}/{stepper.total}</div>
          {bookBtn && <button className="btn-primary" style={{ height: 46, padding: '0 18px', fontSize: 17, boxShadow: '0 5px 0 #B9481B', rotate: '0deg' }} onClick={() => go({ screen: 'book', placeId: bookBtn! })}>{t('In our scrapbook')}</button>}
        </div>
      )}
      {peekBtn && !pov && !action && <button className="btn-cream peek-btn" onClick={() => setPeek(v => !v)}>{t(peek ? 'Put the roof back' : 'Look inside')}</button>}
      {action && !pov && <div className="place-btn"><button className="btn-primary" style={{ height: 84, fontSize: 30 }} onClick={action.run}><Arrow />{action.label}</button></div>}
      {back && !pov && (back.to.screen === 'stack'
        ? <button className="btn-cream back back-icon" aria-label={t(back.label)} onClick={() => go(back!.to)}><MapIcon size={64} /></button>
        : <Back label={back.label} onClick={() => go(back!.to)} />)}
      {showDock && <Dock items={['home', 'book']} go={dest} point={pointPrompt ? 'home' : undefined} />}
    </div>
  );
}

const PlayGlyph = () => <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M8 5 L25 15 L8 25 Z" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>;
