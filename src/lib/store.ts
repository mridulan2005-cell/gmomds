// App state: local-first, persisted in IndexedDB. Scans (JPEG blobs) are stored under their own keys.
import { useSyncExternalStore } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import type { AppState, Drawing, Month, Pair, Place, PersonId, Prompt } from './types';
import { LOVE_PROMPTS, THEMES, ICON, MAPS, EXAMPLE_PAIRS, guessFor, fillFor } from './content';

const KEY = 'dadis-map:state';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The n-th map: a kind of place (a town, a hillside, an animal sanctuary…) whose four places are named for it. */
function newMonth(n: number): Month {
  const kind = MAPS[n % MAPS.length];
  return {
    id: uid(), name: kind.name,
    places: THEMES.map((t, i): Place => ({ id: uid(), index: i, name: kind.places[i], theme: t.theme, shape: t.shape, color: t.color, status: i === 0 ? 'current' : 'locked', pairs: [] })),
  };
}

function sampleDrawing(s: AppState, who: PersonId, promptId: string, kind: string, createdAt = Date.now()): Drawing {
  const g = guessFor(kind), id = uid();
  const d: Drawing = { id, personId: who, promptId, createdAt, paths: { ...ICON[kind] }, kind, label: g.label, motion: g.motion, place: g.place, fillColor: fillFor(kind), confidence: 1, alternatives: [], source: 'sample' };
  s.drawings[id] = d; return d;
}

/** Two finished maps to start with (after the one in progress), so the stack and the scrapbook aren't empty. */
function addExampleMaps(s: AppState) {
  const DAY = 86400000;
  for (const n of [1, 2]) {
    const m = newMonth(n);
    m.places.forEach((p, pi) => {
      p.status = 'done';
      const pool = EXAMPLE_PAIRS[p.theme];
      for (let k = 0; k < 7; k++) {
        const [prompt, a, b] = pool[(k + n - 1) % pool.length], pid = uid(), at = Date.now() - ((n * 4 - pi) * 7 - k) * DAY;
        const d = sampleDrawing(s, 'dadi', pid, n === 1 ? a : b, at), c = sampleDrawing(s, 'child', pid, n === 1 ? b : a, at);
        p.pairs.push({ promptId: pid, prompt, dadi: d.id, child: c.id, slot: k });
      }
    });
    s.months.push(m);
  }
  s.examples = true;
}

function fresh(): AppState {
  const s: AppState = { version: 1, onboarded: false, names: { dadi: 'Dadi', child: 'Anu' }, loves: { dadi: [], child: [] }, months: [newMonth(0)], drawings: {}, prompt: null, recentPrompts: [], scanning: null, lastFresh: null };
  addExampleMaps(s);
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
      if (!s.examples) { addExampleMaps(state); persist(); }
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
/** The place in progress has all seven pairs and waits for its reveal. */
export const readyToReveal = (s: AppState) => { const p = currentPlace(s); return !!p && p.pairs.length >= 7; };

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
  if (!place || place.pairs.length >= 7 || promptBusy) return;
  const done = promptDone(s);
  const stillGood = s.prompt && s.prompt.placeId === place.id && (!done || s.prompt.date === today());
  if (!force && stillGood) return;
  promptBusy = true;
  let text = curatedPrompt(s, place.theme);
  try {
    const r = await fetch('/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: place.theme, loves: s.loves, recent: s.recentPrompts, childName: s.names.child }), signal: AbortSignal.timeout(9000) });
    if (r.ok) { const j = await r.json(); if (j.text && j.text.length < 80) text = j.text; }
  } catch { /* offline: curated list */ }
  promptBusy = false;
  update(st => { const p: Prompt = { id: uid(), text, date: today(), placeId: place.id }; st.prompt = p; st.recentPrompts = [...st.recentPrompts, text].slice(-20); st.scanning = null; });
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
    if (d.personId === 'dadi') { s.scanning = { promptId: s.prompt.id, dadi: d.id }; return; }
    // the grandchild's scan completes the pair: place it on the island
    const dadiId = s.scanning?.dadi; const place = s.months[0].places.find(p => p.status === 'current');
    if (!dadiId || !place) return;
    const pair: Pair = { promptId: s.prompt.id, prompt: s.prompt.text, dadi: dadiId, child: d.id, slot: place.pairs.length };
    place.pairs.push(pair); s.scanning = null; s.lastFresh = { placeId: place.id, slot: pair.slot };
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
export function updateDrawing(id: string, patch: Partial<Drawing>) { update(s => { if (s.drawings[id]) Object.assign(s.drawings[id], patch); }); }
export function clearFresh() { if (state.lastFresh) update(s => { s.lastFresh = null; }); }

/** Finish the place: reveal its theme, unlock the next one; a fourth place finishes the map and starts the next kind of map. */
export function completePlace() {
  update(s => {
    const m = s.months[0], i = m.places.findIndex(p => p.status === 'current');
    if (i < 0 || m.places[i].pairs.length < 7) return;
    m.places[i].status = 'done';
    if (i + 1 < m.places.length) m.places[i + 1].status = 'current';
    else s.months.unshift(newMonth(s.months.length));
    s.prompt = null;
  });
  void ensurePrompt();
}

export function finishOnboarding(names: { dadi: string; child: string }, loves: { dadi: string[]; child: string[] }) {
  update(s => { s.names = names; s.loves = loves; s.onboarded = true; });
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
    for (let k = 0; k < n && place.pairs.length < 7; k++) {
      const pid = uid(), mk = (who: PersonId) => sampleDrawing(s, who, pid, kinds[Math.floor(Math.random() * kinds.length)]);
      const a = mk('dadi'), b = mk('child');
      place.pairs.push({ promptId: pid, prompt: 'Sample: ' + a.kind + ' & ' + b.kind, dadi: a.id, child: b.id, slot: place.pairs.length });
    }
  });
}

export { uid };
