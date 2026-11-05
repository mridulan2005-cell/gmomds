// App state: local-first, persisted in IndexedDB. Scans (JPEG blobs) are stored under their own keys.
import { useSyncExternalStore } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import type { AppState, Drawing, Month, Pair, Place, PersonId, Prompt } from './types';
import { LOVE_PROMPTS, THEMES, ICON, MAPS, PAIRS, WELCOME_DRAWN, guessFor, fillFor, mapDef } from './content';
import { likelyFor } from './likely';

const KEY = 'dadis-map:state';
/** Placeholder caricatures, until they draw each other. */
export const SKETCH = { dadi: import.meta.env.BASE_URL + 'sketch-dadi.png', child: import.meta.env.BASE_URL + 'sketch-aarav.png' };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The n-th map they make: the Welcome Party, the Dream House, then kinds of places (a town, a hillside…). */
function newMonth(n: number): Month {
  const def = mapDef(n);
  return {
    id: uid(), name: def.name, ...(def.dream ? { dream: true } : {}),
    places: def.places.map((t, i): Place => ({
      id: uid(), index: i, name: t.name, theme: t.theme, shape: t.shape, color: t.color, status: i === 0 ? 'current' : 'locked', pairs: [],
      ...(t.prompts ? { total: t.prompts.length, prompts: t.prompts } : {}), ...(t.room ? { room: t.room } : {}),
    })),
  };
}

/**
 * A Dream House saved before it was built as one house (Living Room, Kitchen, Park): give it its rooms, the new prompts
 * and the house itself between the Kitchen and the Park. Drawings already made stay in their room.
 */
function upgradeDream(m: Month, n: number) {
  if (m.dream || m.name !== 'Dream House') return;
  const fresh = newMonth(n);
  let open = true;
  fresh.places.forEach(p => {
    const old = m.places.find(o => o.name === p.name);
    if (old) { p.id = old.id; p.pairs = old.pairs.slice(0, placeTotal(p)); }
    const full = p.pairs.length >= placeTotal(p) && (!old || old.status === 'done');
    p.status = full && open ? 'done' : open ? 'current' : 'locked';
    if (p.status !== 'done') open = false;
  });
  m.places = fresh.places; m.dream = true;
}
/** Pairs that finish a place. */
export const placeTotal = (p: Place) => p.total || PAIRS;

function sampleDrawing(s: AppState, who: PersonId, promptId: string, kind: string, createdAt = Date.now()): Drawing {
  const g = guessFor(kind), id = uid();
  const d: Drawing = { id, personId: who, promptId, createdAt, paths: { ...ICON[kind] }, kind, label: g.label, motion: g.motion, place: g.place, fillColor: fillFor(kind), confidence: 1, alternatives: [], source: 'sample' };
  s.drawings[id] = d; return d;
}

/**
 * A placeholder drawing for a prompt, without a scan (the skip on the scan screen, for trying the app without paper):
 * the prototype's icon of something likely for that prompt. Dadi and the grandchild get different ones when they can.
 */
export function placeholderDrawing(who: PersonId, promptId: string, prompt: string, single = false): Drawing {
  const likely = likelyFor(prompt).map(w => (w === 'house' ? 'home' : w)).filter(k => ICON[k] && k !== 'home');
  const any = Object.keys(ICON).filter(k => k !== 'home');
  const kind = single ? 'home' : likely.length ? likely[(who === 'dadi' ? 0 : 1) % likely.length] : any[Math.floor(Math.random() * any.length)];
  const g = guessFor(kind);
  return {
    id: uid(), personId: who, promptId, createdAt: Date.now(), paths: { ...ICON[kind] }, kind, label: single ? 'our dream house' : g.label,
    motion: g.motion, place: g.place, fillColor: fillFor(kind, who === 'dadi' ? 0 : 1), confidence: 1, alternatives: [], source: 'sample',
  };
}

function fresh(): AppState {
  // the first map is the Welcome Party; finished maps join the stack as they make them
  const s: AppState = { version: 1, onboarded: false, names: { dadi: 'Sunita', child: 'Aarav' }, loves: { dadi: [], child: [] }, faces: { ...SKETCH }, months: [newMonth(0)], drawings: {}, prompt: null, recentPrompts: [], scanning: null, lastFresh: null, examples: true };
  // the party is already in full swing: its first pairs are drawn, so their first prompt after onboarding is its last one
  const party = s.months[0].places[0], DAY = 86_400_000;
  WELCOME_DRAWN.forEach(([a, b], k) => {
    const pid = uid(), at = Date.now() - (WELCOME_DRAWN.length - k) * DAY;
    const d = sampleDrawing(s, 'dadi', pid, a, at), c = sampleDrawing(s, 'child', pid, b, at);
    party.pairs.push({ promptId: pid, prompt: party.prompts![k].text, dadi: d.id, child: c.id, slot: k });
  });
  return s;
}

let state: AppState = fresh();
let loaded = false;
const subs = new Set<() => void>();
let saveTimer: number | undefined;

function emit() { subs.forEach(f => f()); }
function persist() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => { set(KEY, state).catch(e => console.warn('save failed', e)); }, 150); }
export function update(fn: (s: AppState) => AppState | void) {
  const draft = structuredClone(state); const out = fn(draft) || draft; state = out; persist(); emit();
}
export const getState = () => state;
export function useApp(): AppState { return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state); }
export function useLoaded() { return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => loaded); }

export async function load() {
  try {
    const s = await get<AppState>(KEY);
    if (s && s.version === 1) {
      state = { ...fresh(), ...s };
      // maps used to be named after months; name them for kinds of places instead, and add the example maps once
      const months = new Set(Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en', { month: 'long' })));
      state.months.forEach((m, i) => { if (months.has(m.name)) m.name = MAPS[(state.months.length - 1 - i) % MAPS.length].name; });
      // the old placeholder names become Sunita and Aarav
      if (state.names.dadi === 'Dadi' && state.names.child === 'Anu') { state.names = { dadi: 'Sunita', child: 'Aarav' }; persist(); }
      // the Dream House is now built as one house with rooms
      state.months.forEach((m, i) => { if (!m.dream && m.name === 'Dream House') { upgradeDream(m, state.months.length - 1 - i); if (i === 0) state.prompt = null; persist(); } });
      // collaborative tasks are one shared drawing now (they both work on it), scanned once
      const collab = (x: { title?: string; together?: boolean; single?: boolean }) => x.together && x.title === 'Collaborative Task' && !x.single;
      state.months.forEach(m => m.places.forEach(p => p.prompts?.forEach(q => { if (collab(q)) { q.single = true; persist(); } })));
      if (state.prompt && collab(state.prompt)) { state.prompt.single = true; if (state.scanning?.promptId === state.prompt.id) state.scanning = null; persist(); }
      // the Dream House in progress ends with a bridge to the next map now (unlocked at the pin)
      const m0 = state.months[0];
      if (m0?.dream && !m0.places.some(p => p.room === 'bridge')) {
        const def = mapDef(state.months.length - 1).places.find(p => p.room === 'bridge');
        if (def) { m0.places.push({ id: uid(), index: m0.places.length, name: def.name, theme: def.theme, shape: def.shape, color: def.color, status: 'locked', pairs: [], total: def.prompts!.length, prompts: def.prompts, room: 'bridge' }); persist(); }
      }
    }
  } catch (e) { console.warn('load failed', e); }
  loaded = true; emit();
}

// ---------- selectors ----------
export const currentMonth = (s: AppState) => s.months[0];
export const currentPlace = (s: AppState): Place | undefined => s.months[0].places.find(p => p.status === 'current');
export function placeById(s: AppState, id: string): { place: Place; mi: number; pi: number } | null {
  for (let mi = 0; mi < s.months.length; mi++) { const pi = s.months[mi].places.findIndex(p => p.id === id); if (pi >= 0) return { place: s.months[mi].places[pi], mi, pi }; }
  return null;
}
/** Today's pair is finished when the current prompt already has a pair on the map. */
export function promptDone(s: AppState) { const p = s.prompt; if (!p) return false; return s.months.some(m => m.places.some(pl => pl.pairs.some(pr => pr.promptId === p.id))); }
/** The place in progress has all its pairs and waits for its reveal. */
export const readyToReveal = (s: AppState) => { const p = currentPlace(s); return !!p && p.pairs.length >= placeTotal(p); };
const DAY = 86_400_000;
/** When the next prompt arrives: 24 hours after today's pair was finished (midnight for pairs made before that was recorded). */
export function nextPromptAt(s: AppState) {
  if (s.doneAt) return s.doneAt + DAY;
  const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime();
}

// ---------- prompts ----------
function curatedPrompt(s: AppState, theme: string): string {
  const t = THEMES.find(x => x.theme === theme) || THEMES[0];
  const loves = [...s.loves.dadi, ...s.loves.child];
  const fromLoves = loves.flatMap(k => LOVE_PROMPTS[k] || []);
  const pool = (Math.random() < 0.35 && fromLoves.length ? fromLoves : t.prompts).filter(p => !s.recentPrompts.includes(p));
  const list = pool.length ? pool : t.prompts;
  return list[Math.floor(Math.random() * list.length)];
}

let promptBusy = false;
/** Make sure there is a prompt for today. A missed day carries the prompt over; a finished one is replaced the next day. */
export async function ensurePrompt(force = false) {
  const s = state, place = currentPlace(s);
  if (!place || place.pairs.length >= placeTotal(place) || promptBusy) return;
  // the bridge's prompt waits until they walk to the pin on the map
  if (place.room === 'bridge' && !s.pinReached) return;
  const done = promptDone(s);
  const stillGood = s.prompt && s.prompt.placeId === place.id && (!done || Date.now() < nextPromptAt(s));
  if (!force && stillGood) return;
  // a curated place has its own prompts, in order
  const own = place.prompts?.[place.pairs.length];
  if (own) {
    const { text: _t, ...extra } = own;
    update(st => { st.prompt = { id: uid(), text: own.text, date: today(), placeId: place.id, ...extra }; st.recentPrompts = [...st.recentPrompts, own.text].slice(-20); st.scanning = null; });
    return;
  }
  promptBusy = true;
  let text = curatedPrompt(s, place.theme), hi: string | undefined;
  try {
    const r = await fetch('/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: place.theme, loves: s.loves, recent: s.recentPrompts, childName: s.names.child }), signal: AbortSignal.timeout(9000) });
    if (r.ok) { const j = await r.json(); if (j.text && j.text.length < 80) { text = j.text; if (typeof j.hi === 'string' && j.hi.length < 120) hi = j.hi; } }
  } catch { /* offline: curated list */ }
  promptBusy = false;
  update(st => { const p: Prompt = { id: uid(), text, date: today(), placeId: place.id, ...(hi ? { hi } : {}) }; st.prompt = p; st.recentPrompts = [...st.recentPrompts, text].slice(-20); st.scanning = null; });
}

// ---------- scanning ----------
export async function saveScan(id: string, jpeg: Blob, kind: 'scan' | 'art' = 'scan') { try { await set(kind + ':' + id, jpeg); } catch (e) { console.warn('scan save failed', e); } }
const urlCache = new Map<string, string>();
async function blobUrl(key: string): Promise<string | null> {
  if (urlCache.has(key)) return urlCache.get(key)!;
  try { const b = await get<Blob>(key); if (!b) return null; const u = URL.createObjectURL(b); urlCache.set(key, u); return u; } catch { return null; }
}
/** The photo of the paper (scrapbook). */
export const scanUrl = (id: string) => blobUrl('scan:' + id);
/** The drawing itself, white-balanced, printed on its 3D cut-out. */
export const artUrl = (id: string) => blobUrl('art:' + id);

export function addDrawing(d: Drawing) {
  update(s => {
    s.drawings[d.id] = d;
    if (!s.prompt) return;
    // one shared drawing (the dream house) is the whole pair; otherwise Dadi's scan waits for the grandchild's
    const single = !!s.prompt.single;
    if (d.personId === 'dadi' && !single) { s.scanning = { promptId: s.prompt.id, dadi: d.id }; return; }
    // the grandchild's scan completes the pair: place it on the island
    const dadiId = single ? d.id : s.scanning?.dadi; const place = s.months[0].places.find(p => p.status === 'current');
    if (!dadiId || !place) return;
    const pair: Pair = { promptId: s.prompt.id, prompt: s.prompt.text, ...(s.prompt.hi ? { hi: s.prompt.hi } : {}), dadi: dadiId, child: d.id, slot: place.pairs.length, ...pairExtra(s.prompt) };
    place.pairs.push(pair); s.scanning = null; s.lastFresh = { placeId: place.id, slot: pair.slot }; s.doneAt = Date.now();
  });
}
/** A retake: the new scan takes the old one's place (in the pair on the map, or the scan in progress). */
export function replaceDrawing(oldId: string, d: Drawing) {
  update(s => {
    s.drawings[d.id] = d; delete s.drawings[oldId];
    for (const m of s.months) for (const p of m.places) for (const pr of p.pairs) { if (pr.dadi === oldId) pr.dadi = d.id; if (pr.child === oldId) pr.child = d.id; }
    if (s.scanning?.dadi === oldId) s.scanning.dadi = d.id;
  });
  for (const k of ['scan:' + oldId, 'art:' + oldId]) { const u = urlCache.get(k); if (u) URL.revokeObjectURL(u); urlCache.delete(k); void del(k).catch(() => {}); }
}
const pairExtra = (p: { together?: boolean; single?: boolean; title?: string }) => ({ ...(p.together ? { together: true } : {}), ...(p.single ? { single: true } : {}), ...(p.title ? { title: p.title } : {}) });
export function updateDrawing(id: string, patch: Partial<Drawing>) { update(s => { if (s.drawings[id]) Object.assign(s.drawings[id], patch); }); }
export function clearFresh() { if (state.lastFresh) update(s => { s.lastFresh = null; }); }

/** Finish the place: reveal its theme, unlock the next one; a fourth place finishes the map and starts the next kind of map. */
export function completePlace() {
  update(s => {
    const m = s.months[0], i = m.places.findIndex(p => p.status === 'current');
    if (i < 0 || m.places[i].pairs.length < placeTotal(m.places[i])) return;
    m.places[i].status = 'done';
    if (i + 1 < m.places.length) m.places[i + 1].status = 'current';
    else { s.months.unshift(newMonth(s.months.length)); s.pinReached = false; }
    s.prompt = null;
  });
  void ensurePrompt();
}

/** They walked to the pin: the bridge becomes today's prompt, right away. */
export function reachPin() {
  update(s => { s.pinReached = true; s.prompt = null; s.scanning = null; });
  void ensurePrompt(true);
}
/** Waiting for them to walk to the pin (the bridge is next, and not unlocked yet). */
export const awaitingPin = (s: AppState) => { const p = currentPlace(s); return !!p && p.room === 'bridge' && !s.pinReached; };

export function finishOnboarding(names: { dadi: string; child: string }, loves: { dadi: string[]; child: string[] }, faces: { dadi: string; child: string }, role: string, lang?: string) {
  update(s => { s.names = names; s.loves = loves; s.faces = faces; s.role = role; s.onboarded = true; if (lang) s.lang = lang; });
  void ensurePrompt();
}

export async function resetAll() {
  try { for (const k of await keys()) if (String(k).startsWith('scan:') || String(k).startsWith('art:') || k === KEY) await del(k); } catch { /* ignore */ }
  state = fresh(); emit(); persist();
}

/** Fill the place in progress with sample pairs (prototype icons), to try the map and the reveal quickly. */
export function addSamplePairs(n: number) {
  const kinds = Object.keys(ICON);
  update(s => {
    const place = s.months[0].places.find(p => p.status === 'current'); if (!place) return;
    for (let k = 0; k < n && place.pairs.length < placeTotal(place); k++) {
      const pid = uid(), own = place.prompts?.[place.pairs.length], mk = (who: PersonId) => sampleDrawing(s, who, pid, own?.single ? 'home' : kinds[Math.floor(Math.random() * kinds.length)]);
      // a shared drawing is one drawing; the sample dream house is the prototype's drawing of one
      const a = mk('dadi'), b = own?.single ? a : mk('child');
      if (own?.single) a.label = 'our dream house';
      place.pairs.push({ promptId: pid, prompt: own ? own.text : 'Sample: ' + a.kind + ' & ' + b.kind, dadi: a.id, child: b.id, slot: place.pairs.length, ...(own ? pairExtra(own) : {}) });
    }
    // today's prompt moves on with them
    if (place.prompts) { s.prompt = null; s.scanning = null; }
  });
  void ensurePrompt();
}

export { uid };
