// Free, on-device drawing recognition: CLIP (an image–text model) scores the drawing against words.
// Runs in its own worker so the camera stays smooth. The model (about 90 MB) is downloaded once from
// Hugging Face and then kept by the browser's cache.
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';

env.allowLocalModels = false; // fetch from the Hugging Face hub, not from this site

const MODEL = 'Xenova/clip-vit-base-patch32';
// a few ways of saying it, averaged: CLIP knows photos best, and these are children's drawings
const TEMPLATES = ["a child's drawing of a {}", 'a crayon drawing of a {}', 'a simple pencil sketch of a {}', 'a doodle of a {}'];

type Parts = { tok: any; text: any; proc: any; vision: any };
let parts: Promise<Parts> | null = null;
const load = () => (parts ??= (async () => {
  const [tok, text, proc, vision] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL),
    CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
    AutoProcessor.from_pretrained(MODEL),
    CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
  ]);
  return { tok, text, proc, vision };
})().catch(e => { parts = null; throw e; }));

const unit = (v: Float32Array) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map(x => x / n); };
const words = new Map<string, Float32Array>(); // label → its text embedding, computed once

async function embedWords(labels: string[]) {
  const todo = labels.filter(l => !words.has(l));
  if (!todo.length) return;
  const { tok, text } = await load();
  const texts = todo.flatMap(l => TEMPLATES.map(t => t.replace('{}', l)));
  const { text_embeds } = await text(tok(texts, { padding: true, truncation: true }));
  const d = text_embeds.dims[1], all = text_embeds.data as Float32Array;
  todo.forEach((l, i) => {
    const avg = new Float32Array(d);
    for (let t = 0; t < TEMPLATES.length; t++) { const v = unit(all.slice((i * TEMPLATES.length + t) * d, (i * TEMPLATES.length + t + 1) * d)); for (let k = 0; k < d; k++) avg[k] += v[k]; }
    words.set(l, unit(avg));
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { id, op } = e.data;
  try {
    if (op === 'warm') { await load(); await embedWords(e.data.labels); self.postMessage({ id, ok: true }); return; }
    const { width, height, buf, labels } = e.data as { width: number; height: number; buf: ArrayBuffer; labels: string[] };
    await embedWords(labels);
    const { proc, vision } = await load();
    const image = new RawImage(new Uint8ClampedArray(buf), width, height, 4).rgb();
    const { image_embeds } = await vision(await proc(image));
    const img = unit(image_embeds.data as Float32Array);
    // cosine similarity, scaled as CLIP was trained (×100), then softmax
    const logits = labels.map(l => { const w = words.get(l)!; let s = 0; for (let k = 0; k < img.length; k++) s += img[k] * w[k]; return s * 100; });
    const mx = Math.max(...logits), ex = logits.map(v => Math.exp(v - mx)), sum = ex.reduce((a, b) => a + b, 0);
    self.postMessage({ id, scores: labels.map((label, i) => ({ label, score: ex[i] / sum })) });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message || err) });
  }
};
