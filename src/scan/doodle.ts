// On-device doodle recognition with DoodleNet (a small CNN trained on Google's Quick, Draw! dataset, 345 things).
// Used when Claude can't be reached, so drawings still come to life with no API key or no internet to the server.
// The model loads lazily: first from /models/doodlenet (after `npm run fetch-model`), then from the public CDN.
import type { Vector } from './pipeline';
import { DOODLE_LABELS } from './doodleLabels';

const SOURCES = [
  (import.meta.env.VITE_DOODLENET_URL as string | undefined) || '',
  '/models/doodlenet/model.json',
  'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/doodlenet/model.json',
].filter(Boolean);

type TF = typeof import('@tensorflow/tfjs');
let loading: Promise<{ tf: TF; model: import('@tensorflow/tfjs').LayersModel } | null> | null = null;

function load() {
  return (loading ||= (async () => {
    const tf = await import('@tensorflow/tfjs');
    for (const url of SOURCES) {
      try {
        const model = await tf.loadLayersModel(url);
        tf.tidy(() => model.predict(tf.zeros([1, 28, 28, 1])));
        return { tf, model };
      } catch { /* try the next source */ }
    }
    loading = null; // allow a retry later (e.g. once online)
    return null;
  })());
}
/** Start fetching the model early (e.g. when the scan screen opens). */
export const warmDoodle = () => { void load(); };

/** Draw the traced lines black-on-white like a Quick, Draw! sketch: what DoodleNet was trained on. */
export function sketchCanvas(v: Vector, size = 280): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
  // the drawing sits on y=60 in its 64 box; centre it in a square with a margin
  const nums = (v.f.join(' ') + ' ' + v.s.join(' ')).match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
  let x0 = 64, x1 = 0, y0 = 64, y1 = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) { x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]); y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]); }
  const span = Math.max(8, x1 - x0, y1 - y0), k = (size * 0.8) / span;
  x.setTransform(k, 0, 0, k, size / 2 - ((x0 + x1) / 2) * k, size / 2 - ((y0 + y1) / 2) * k);
  x.strokeStyle = '#000'; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = 16 / k;
  for (const d of [...v.f, ...v.s]) x.stroke(new Path2D(d));
  return c;
}

export interface DoodleGuess { label: string; confidence: number }

/** Top guesses for a traced drawing, or null if the model isn't available. */
export async function classifyDoodle(v: Vector, topk = 5): Promise<DoodleGuess[] | null> {
  const m = await Promise.race([load(), new Promise<null>(r => setTimeout(() => r(null), 8000))]);
  if (!m) return null;
  const { tf, model } = m, canvas = sketchCanvas(v);
  // same preprocessing as ml5's DoodleNet: ink = 1, paper = 0, 28×28, one channel
  const probs = tf.tidy(() => {
    const img = tf.browser.fromPixels(canvas).toFloat().div(255);
    const inv = tf.scalar(1).sub(img);
    const small = tf.image.resizeBilinear(inv as import('@tensorflow/tfjs').Tensor3D, [28, 28]);
    const gray = small.mean(2).round().reshape([1, 28, 28, 1]);
    return (model.predict(gray) as import('@tensorflow/tfjs').Tensor).dataSync();
  });
  return Array.from(probs).map((p, i) => ({ label: DOODLE_LABELS[i], confidence: p }))
    .sort((a, b) => b.confidence - a.confidence).slice(0, topk);
}
