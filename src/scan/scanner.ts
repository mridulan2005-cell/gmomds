// Main-thread side of scanning: camera frames → worker → JPEG + vector + recognition.
import type { Img, Quad, ScanResult, Vector } from './pipeline';
import type { Recognition } from '../lib/types';
import { localGuess } from '../lib/content';
import { motionFor, prettyLabel } from '../lib/motionRules';
import { classifyDoodle } from './doodle';

let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, (v: any) => void>();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
  }
  return worker;
}
function call(op: 'detect' | 'process', img: Img): Promise<any> {
  const id = ++seq, buf = img.data.buffer as ArrayBuffer;
  return new Promise(res => { waiting.set(id, res); getWorker().postMessage({ id, op, img: { width: img.width, height: img.height, buf } }, [buf]); });
}

export async function detect(img: Img): Promise<Quad | null> { const r = await call('detect', img); return r.quad || null; }
export async function process(img: Img): Promise<ScanResult> {
  const r = await call('process', img);
  if (r.error) throw new Error(r.error);
  return r.result;
}

/** Grab a frame from a video or image element into RGBA pixels (longest side ≤ maxSide). */
export function grab(src: HTMLVideoElement | HTMLImageElement | ImageBitmap, maxSide: number): Img | null {
  const w0 = 'videoWidth' in src ? src.videoWidth : src.width, h0 = 'videoHeight' in src ? src.videoHeight : src.height;
  if (!w0 || !h0) return null;
  const s = Math.min(1, maxSide / Math.max(w0, h0)), w = Math.round(w0 * s), h = Math.round(h0 * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(src as CanvasImageSource, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

export function toCanvas(img: Img, maxSide = 4096): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (Math.max(img.width, img.height) <= maxSide) return c;
  const s = maxSide / Math.max(img.width, img.height), o = document.createElement('canvas'); o.width = Math.round(img.width * s); o.height = Math.round(img.height * s);
  o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height); return o;
}
export const toBlob = (c: HTMLCanvasElement, type = 'image/jpeg', q = 0.86) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), type, q));

/**
 * What is it? Works for any drawing:
 *  1. Claude vision (through our server): open-ended, names anything and picks how it should move.
 *  2. DoodleNet on the tablet (Quick, Draw! dataset, 345 everyday things) when Claude can't be reached.
 *  3. The day's prompt words, as a last resort.
 */
export async function recognise(crop: Img, prompt: string, who: 'dadi' | 'child', vector?: Vector): Promise<Recognition> {
  try {
    const c = toCanvas(crop, 768), image = c.toDataURL('image/jpeg', 0.85);
    const r = await fetch('/api/recognise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, mediaType: 'image/jpeg', prompt, who }), signal: AbortSignal.timeout(25000) });
    if (r.ok) { const j = await r.json(); if (j && j.kind) return { ...j, source: 'claude' }; }
  } catch { /* offline or no key */ }
  const fromPrompt = localGuess(prompt);
  if (vector) {
    try {
      const top = await classifyDoodle(vector);
      if (top && top.length) {
        const guesses = top.map(t => ({ ...motionFor(t.label), kind: t.label.toLowerCase(), label: prettyLabel(t.label), confidence: t.confidence }));
        // the prompt is a strong hint: prefer a likely guess that matches it ("Draw something that flies" → bird over cup)
        const promptWords = prompt.toLowerCase();
        const match = guesses.find(g => g.confidence > 0.03 && (promptWords.includes(g.kind.replace(/_/g, ' ')) || g.kind === fromPrompt.kind || (fromPrompt.confidence > 0.2 && g.motion === fromPrompt.motion && g.motion !== 'breathe')));
        const best = match || guesses[0];
        if (best.confidence > 0.12 || match) {
          const alternatives = guesses.filter(g => g !== best).map(({ kind, label, motion, place }) => ({ kind, label, motion, place }));
          const confidence = Math.min(1, best.confidence + (match ? 0.2 : 0));
          return { kind: best.kind, label: best.label, motion: confidence < 0.2 ? 'breathe' : best.motion, place: best.place, confidence, alternatives, source: 'local' };
        }
        fromPrompt.alternatives = [...guesses.slice(0, 3).map(({ kind, label, motion, place }) => ({ kind, label, motion, place })), ...fromPrompt.alternatives].slice(0, 5);
      }
    } catch (e) { console.warn('doodle recognition failed', e); }
  }
  return { ...fromPrompt, source: 'local' };
}

/** A tiny greyscale thumbnail, to notice when a new sheet has been put down. */
export function thumb(img: Img): Float32Array {
  const W = 32, H = 24, o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = (Math.floor((y + 0.5) * img.height / H) * img.width + Math.floor((x + 0.5) * img.width / W)) * 4; o[y * W + x] = (img.data[j] + img.data[j + 1] + img.data[j + 2]) / 765; }
  return o;
}
export const thumbDiff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
