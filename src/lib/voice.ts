// A friendly female Indian voice reads out each screen: what it is and what to do next (English or Hindi).
// Best: a natural neural voice from the server (/api/tts). Otherwise the device's own voices, the most natural one it has,
// spoken a sentence at a time with a little lift and pause so it does not drone. The mute button turns it off.
import { useEffect, useSyncExternalStore } from 'react';
import type { Lang } from './i18n';

const MUTE_KEY = 'dadis-map:muted';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

let muted = read(MUTE_KEY) === '1';
const subs = new Set<() => void>();
export const useMuted = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => muted);

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
/** the line this screen wants said (said again when the voice is turned back on) */
let last: { text: string; lang: Lang; mood: Mood; said: boolean } | null = null;
/** warm: friendly, natural; excited: a place finished, a map come alive, a pin found */
export type Mood = 'warm' | 'excited';
// browsers only play sound after the first tap: say the waiting line then
let active = typeof navigator !== 'undefined' && !!(navigator as any).userActivation?.hasBeenActive;
if (typeof window !== 'undefined') {
  const wake = () => { active = true; if (last && !last.said) speak(); };
  window.addEventListener('pointerdown', wake, { capture: true, once: true });
  window.addEventListener('keydown', wake, { capture: true, once: true });
  synth?.addEventListener?.('voiceschanged', () => { cache.clear(); });
}

export function setMuted(m: boolean) {
  muted = m; write(MUTE_KEY, m ? '1' : '0'); subs.forEach(f => f());
  if (m) stop(); else if (last) { last.said = false; speak(); }
}

// ---- the natural voice from the server ----
/** null: not known yet; the server says whether it has a voice */
let cloud: boolean | null = null, voiceTag = '';
const cloudReady = typeof fetch === 'undefined' ? Promise.resolve(false)
  : fetch('/api/health').then(r => r.json()).then(j => { voiceTag = String(j?.voice || ''); return (cloud = !!j?.tts); }).catch(() => (cloud = false));
// each line is kept on the tablet once it has been made, so it is never paid for twice (a new voice starts afresh)
const BOX = 'dadis-map-voice-v1';
async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
async function fetchClip(text: string, lang: Lang, mood: Mood): Promise<Blob | null> {
  let box: Cache | null = null, key = '';
  try { box = await caches.open(BOX); key = '/voice/' + (await hash([voiceTag, lang, mood, text].join('|'))) + '.mp3'; const hit = await box.match(key); if (hit) return await hit.blob(); } catch { box = null; }
  const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang, mood }) });
  if (!r.ok) return null;
  const b = await r.blob();
  if (box && b.size) void box.put(key, new Response(b, { headers: { 'content-type': 'audio/mpeg' } })).catch(() => {});
  return b;
}
const clips = new Map<string, Promise<string | null>>();
function clip(text: string, lang: Lang, mood: Mood): Promise<string | null> {
  const k = lang + '|' + mood + '|' + text;
  if (!clips.has(k)) clips.set(k, fetchClip(text, lang, mood)
    .then(b => (b && b.size ? URL.createObjectURL(b) : null))
    .catch(() => null)
    .then(u => { if (!u) clips.delete(k); return u; }));
  return clips.get(k)!;
}
let audio: HTMLAudioElement | null = null, turn = 0;

function stop() {
  turn++;
  if (audio) { audio.pause(); audio = null; }
  synth?.cancel();
}

// ---- the device's own voices ----
// female voices by name on common devices (Chrome, Edge, iOS/macOS, Android)
const FEMALE = /female|woman|neerja|swara|lekha|veena|kalpana|heera|aditi|raveena|kajal|sangeeta|priya|ananya|isha|google हिन्दी|google hindi|samantha|zira|aria|jenny/i;
const MALE = /\bmale\b|ravi|hemant|prabhat|madhur|rishi|aarav|kunal|rahul|prabhat|david|mark|daniel|alex|fred/i;
// the neural ones ("Natural", "Online", "Neural", Google's, Apple's enhanced/premium) sound far less robotic
const NATURAL = /natural|neural|online|premium|enhanced|google/i;
const cache = new Map<Lang, SpeechSynthesisVoice | null>();
function pick(lang: Lang): SpeechSynthesisVoice | null {
  if (cache.has(lang)) return cache.get(lang)!;
  const all = synth?.getVoices() || [];
  if (!all.length) return null;
  const isF = (v: SpeechSynthesisVoice) => FEMALE.test(v.name) && !(MALE.test(v.name) && !/female/i.test(v.name));
  const notM = (v: SpeechSynthesisVoice) => !MALE.test(v.name) || /female/i.test(v.name);
  const nat = (v: SpeechSynthesisVoice) => NATURAL.test(v.name);
  const by = (code: string) => all.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(code));
  const hi = by('hi'), enIN = by('en-in'), en = by('en');
  const both = (v: SpeechSynthesisVoice) => isF(v) && nat(v);
  const order = lang === 'hi'
    ? [hi.find(both), hi.find(isF), hi.find(v => nat(v) && notM(v)), hi.find(notM), hi[0]]
    // English with an Indian voice: a natural Indian English woman first, then the Hindi woman (reads English well), then any
    : [enIN.find(both), hi.find(both), enIN.find(isF), enIN.find(notM), en.find(both), hi.find(isF), en.find(isF), enIN[0], en[0]];
  const v = order.find(Boolean) || null;
  cache.set(lang, v); return v;
}

/** One utterance per sentence, each with its own tune: greetings and exclamations brighter, questions lifted, instructions calm. */
function speakDevice(text: string, lang: Lang, mood: Mood) {
  if (!synth) return;
  synth.cancel();
  const v = pick(lang), natural = !!v && NATURAL.test(v.name);
  const parts = (text.match(/[^.!?।]+[.!?।]*/g) || [text]).map(p => p.trim()).filter(Boolean);
  parts.forEach((s, i) => {
    const bang = /!$/.test(s), ask = /\?$/.test(s);
    const u = new SpeechSynthesisUtterance(s);
    u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    if (v) { u.voice = v; u.lang = v.lang; }
    // neural voices already have a natural tune: nudge them gently; the older voices need more help
    // excited: the happy sentences jump up and quicken, the instruction after them settles back down
    const lift = (natural ? 0.5 : 1) * (mood === 'excited' && (bang || i === 0) ? 1.9 : 1);
    u.pitch = Math.min(2, 1 + lift * (bang ? 0.16 : ask ? 0.12 : i === 0 ? 0.08 : (i % 2 ? -0.02 : 0.04)));
    u.rate = (natural ? 0.98 : 0.95) + lift * (bang ? 0.06 : ask ? 0 : -0.04);
    u.volume = 1;
    synth.speak(u);
  });
}

function speak() {
  if (!last || muted) return;
  if (!active) { if (cloud) void clip(last.text, last.lang, last.mood); return; } // waits for the first tap (fetching the clip meanwhile)
  last.said = true;
  stop();
  const me = turn, { text, lang, mood } = last;
  void cloudReady.then(async ok => {
    if (ok) {
      const url = await clip(text, lang, mood);
      if (me !== turn || muted) return;
      if (url) {
        const a = new Audio(url); audio = a;
        a.onended = () => { if (audio === a) audio = null; };
        try { await a.play(); return; } catch { if (audio === a) audio = null; }
      }
    }
    if (me !== turn || muted) return;
    speakDevice(text, lang, mood);
  });
}

/** Say this line (replacing whatever is being said). */
export function say(text: string, lang: Lang, mood: Mood = 'warm') {
  if (!text) return;
  last = { text, lang, mood, said: false };
  speak();
}

/** Each screen says its line when it appears, and again when the line changes. */
export function useSay(text: string | null | undefined, lang: Lang, mood: Mood = 'warm', delay = 450) {
  useEffect(() => {
    if (!text) return;
    if (cloud) void clip(text, lang, mood); // start fetching the natural voice straight away
    const t = setTimeout(() => say(text, lang, mood), delay);
    return () => clearTimeout(t);
  }, [text, lang, mood]);
}
/** Stop talking (leaving a screen that has nothing to say). */
export const hush = () => { last = null; stop(); };
