import type { Img } from './pipeline';
import { EVERYDAY, likelyFor } from '../lib/likely';

let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, (v: any) => void>();
function call(msg: object, transfer: Transferable[] = []): Promise<any> {
  if (!worker) {
    worker = new Worker(new URL('./clip.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
    worker.onerror = () => { for (const r of waiting.values()) r({ error: 'worker' }); waiting.clear(); worker = null; };
  }
  const id = ++seq;
  return new Promise(res => { waiting.set(id, res); worker!.postMessage({ id, ...msg }, transfer); });
}

const labelsFor = (prompt: string) => { const likely = likelyFor(prompt); return { likely, all: [...new Set([...likely, ...EVERYDAY])] }; };

/** Start downloading the model (and reading the day's words) before the first drawing is scanned. */
export function warmClip(prompt: string) { void call({ op: 'warm', labels: labelsFor(prompt).all }); }

export interface ClipGuess { label: string; score: number }

/**
 * What the drawing most likely is, best first, or null if the model could not run (no network on first use, an
 * old browser). Things people usually draw for the day's prompt count for more: the prompt is a strong hint.
 */
export async function classifyClip(img: Img, prompt: string, timeoutMs = 45000): Promise<ClipGuess[] | null> {
  const { likely, all } = labelsFor(prompt), data = new Uint8ClampedArray(img.data);
  const r = await Promise.race([
    call({ op: 'classify', width: img.width, height: img.height, buf: data.buffer, labels: all }, [data.buffer]),
    new Promise<{ error: string }>(res => setTimeout(() => res({ error: 'timeout' }), timeoutMs)),
  ]);
  if (!r || r.error || !r.scores) { if (r?.error) console.warn('on-device recognition unavailable:', r.error); return null; }
  // the prompt's likely answers get up to 3× the weight (most likely first), then back to probabilities
  const boosted = (r.scores as ClipGuess[]).map(g => { const k = likely.indexOf(g.label); return { label: g.label, score: g.score * (k < 0 ? 1 : 3 - (k / likely.length) * 1.5) }; });
  const sum = boosted.reduce((a, g) => a + g.score, 0) || 1;
  return boosted.map(g => ({ label: g.label, score: g.score / sum })).sort((a, b) => b.score - a.score);
}
