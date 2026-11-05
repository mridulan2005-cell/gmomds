// A friendly female Indian voice reads out each screen: what it is and what to do next (English or Hindi).
// It uses the device's own speech voices; the mute button turns it off (remembered on this device).
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
let last: { text: string; lang: Lang; said: boolean } | null = null;
// browsers only speak after the first tap: say the waiting line then
let active = typeof navigator !== 'undefined' && !!(navigator as any).userActivation?.hasBeenActive;
if (typeof window !== 'undefined') {
  const wake = () => { active = true; if (last && !last.said) speak(); };
  window.addEventListener('pointerdown', wake, { capture: true, once: true });
  window.addEventListener('keydown', wake, { capture: true, once: true });
  synth?.addEventListener?.('voiceschanged', () => { cache.clear(); });
}

export function setMuted(m: boolean) {
  muted = m; write(MUTE_KEY, m ? '1' : '0'); subs.forEach(f => f());
  if (m) synth?.cancel(); else if (last) { last.said = false; speak(); }
}

// female voices by name on common devices (Chrome, Edge, iOS/macOS, Android)
const FEMALE = /female|woman|lekha|veena|kalpana|swara|heera|neerja|aditi|raveena|kajal|sangeeta|priya|ananya|isha|google हिन्दी|google hindi|samantha|zira|aria|jenny/i;
const MALE = /\bmale\b|ravi|hemant|prabhat|madhur|rishi|aarav|kunal|rahul|david|mark|daniel|alex|fred/i;
const cache = new Map<Lang, SpeechSynthesisVoice | null>();
function pick(lang: Lang): SpeechSynthesisVoice | null {
  if (cache.has(lang)) return cache.get(lang)!;
  const all = synth?.getVoices() || [];
  if (!all.length) return null;
  const isF = (v: SpeechSynthesisVoice) => FEMALE.test(v.name) && !(MALE.test(v.name) && !/female/i.test(v.name));
  const notM = (v: SpeechSynthesisVoice) => !MALE.test(v.name) || /female/i.test(v.name);
  const by = (code: string) => all.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(code));
  const hi = by('hi'), enIN = by('en-in'), en = by('en');
  const order = lang === 'hi'
    ? [hi.find(isF), hi.find(notM), hi[0]]
    // English with an Indian voice: an Indian English woman, else the Hindi voice (it reads English well), else any English woman
    : [enIN.find(isF), enIN.find(notM), hi.find(isF), en.find(isF), enIN[0], en[0]];
  const v = order.find(Boolean) || null;
  cache.set(lang, v); return v;
}

function speak() {
  if (!last || muted || !synth) return;
  if (!active) return; // waits for the first tap
  last.said = true;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(last.text);
  u.lang = last.lang === 'hi' ? 'hi-IN' : 'en-IN';
  const v = pick(last.lang); if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 0.92; u.pitch = 1.08;
  synth.speak(u);
}

/** Say this line (replacing whatever is being said). */
export function say(text: string, lang: Lang) {
  if (!text) return;
  last = { text, lang, said: false };
  speak();
}

/** Each screen says its line when it appears, and again when the line changes. */
export function useSay(text: string | null | undefined, lang: Lang, delay = 450) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => say(text, lang), delay);
    return () => clearTimeout(t);
  }, [text, lang]);
}
/** Stop talking (leaving a screen that has nothing to say). */
export const hush = () => { last = null; synth?.cancel(); };
