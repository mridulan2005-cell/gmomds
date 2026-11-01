/// <reference lib="webworker" />
import { detectSheet, processScan, type Img } from './pipeline';

type Msg = { id: number; op: 'detect' | 'process'; img: { width: number; height: number; buf: ArrayBuffer } };

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, op, img } = e.data;
  const im: Img = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.buf) };
  try {
    if (op === 'detect') { (self as unknown as Worker).postMessage({ id, sheet: detectSheet(im) }); return; }
    const r = processScan(im);
    const transfer: Transferable[] = [];
    if (r.crop) transfer.push(r.crop.data.buffer);
    if (r.ink) transfer.push(r.ink.data.buffer);
    if (r.vector?.art) transfer.push(r.vector.art.data.buffer);
    (self as unknown as Worker).postMessage({ id, result: r }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
