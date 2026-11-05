// Reading their drawing of the dream house: where its walls, roof and door are, and what colours they are.
// The door is the largest dense patch of dark brown (the prompt asks for the door to be the darkest colour);
// when no clear door is found, a door is placed in the middle of the front wall instead.

export interface HouseShape {
  /** analysis size: the drawing is fitted into W × H */
  W: number; H: number;
  /** where the drawing sits in that box: [x, y, w, h] */
  fit: [number, number, number, number];
  /** the drawing with its background cut out (transparent) */
  src: HTMLCanvasElement;
  /** the front: src with the door cut out of it */
  fc: HTMLCanvasElement;
  /** the door itself */
  dc: HTMLCanvasElement | null;
  /** door box [x0, y0, x1, y1] in pixels; found = it was the brown patch (not a fallback) */
  door: [number, number, number, number] | null; found: boolean;
  /** bottom of the walls, their left and right edges, the eaves (and their extent) and the peak of the roof */
  bodyB: number; bl: number; br: number; eaveY: number; el: number; er: number; apexY: number; mid: number;
  wall: string; roof: string;
}

const W = 600, H = 560;
const isBrown = (r: number, g: number, b: number) => { const lum = 0.3 * r + 0.59 * g + 0.11 * b; return r > 50 && lum < 110 && g / r > 0.38 && g / r < 0.8 && b / r < 0.66; };

/** The drawing fitted into the analysis box, with the paper around it (white, reached from the edge) made transparent. */
function cutOut(img: CanvasImageSource & { width: number; height: number }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true })!;
  const iw = (img as HTMLImageElement).naturalWidth || img.width, ih = (img as HTMLImageElement).naturalHeight || img.height;
  const k = Math.min((W - 20) / iw, (H - 20) / ih), dw = iw * k, dh = ih * k;
  x.drawImage(img, (W - dw) / 2, H - 10 - dh, dw, dh);
  const id = x.getImageData(0, 0, W, H), D = id.data, seen = new Uint8Array(W * H), st: number[] = [];
  const paper = (i: number) => { const j = i * 4; if (D[j + 3] < 40) return true; const r = D[j], g = D[j + 1], b = D[j + 2]; return Math.min(r, g, b) > 214 && Math.max(r, g, b) - Math.min(r, g, b) < 30; };
  for (let X = 0; X < W; X++) st.push(X, (H - 1) * W + X);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const i = st.pop()!; if (seen[i] || !paper(i)) continue; seen[i] = 1; D[i * 4 + 3] = 0;
    const X = i % W, y = (i - X) / W;
    if (X > 0) st.push(i - 1); if (X < W - 1) st.push(i + 1); if (y > 0) st.push(i - W); if (y < H - 1) st.push(i + W);
  }
  x.putImageData(id, 0, 0); return { c, D, fit: [(W - dw) / 2, H - 10 - dh, dw, dh] as [number, number, number, number] };
}

export function analyzeHouse(img: CanvasImageSource & { width: number; height: number }): HouseShape {
  const { c, D, fit } = cutOut(img);
  // the door: the biggest connected group of 20px cells dense with dark brown
  const CW = Math.ceil(W / 20), CH = Math.ceil(H / 20), cells = new Uint16Array(CW * CH);
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) { const i = (y * W + X) * 4; if (D[i + 3] < 200) continue; if (isBrown(D[i], D[i + 1], D[i + 2])) cells[Math.floor(X / 20) + Math.floor(y / 20) * CW]++; }
  let best: number[] = []; const seen = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || cells[i] < 40) continue; const grp: number[] = [], st = [i]; seen[i] = 1;
    while (st.length) { const q = st.pop()!; grp.push(q); const cx = q % CW, cy = (q / CW) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + a, ny = cy + b; if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue; const j = ny * CW + nx; if (!seen[j] && cells[j] >= 40) { seen[j] = 1; st.push(j); } } }
    if (grp.length > best.length) best = grp;
  }
  let dx0 = W, dy0 = H, dx1 = 0, dy1 = 0, cnt = 0;
  for (const q of best) { const cx = q % CW, cy = (q / CW) | 0; for (let y = cy * 20; y < Math.min(H, cy * 20 + 20); y++) for (let X = cx * 20; X < Math.min(W, cx * 20 + 20); X++) { const i = (y * W + X) * 4; if (D[i + 3] < 200 || !isBrown(D[i], D[i + 1], D[i + 2])) continue; cnt++; if (X < dx0) dx0 = X; if (X > dx1) dx1 = X; if (y < dy0) dy0 = y; if (y > dy1) dy1 = y; } }
  // the house's outline: its walls are the widest part near the bottom, the eaves stick out past them, the peak is on top
  const ext = (y: number) => { let a = -1, b = -1; for (let X = 0; X < W; X++) if (D[(y * W + X) * 4 + 3] > 60) { if (a < 0) a = X; b = X; } return [a, b]; };
  let bodyB = H - 1; while (bodyB > 0) { const [a, b] = ext(bodyB); if (a >= 0 && b - a > W * 0.3) break; bodyB--; }
  if (bodyB < H * 0.3) bodyB = H - 11;
  let [bl, br] = ext(Math.max(0, bodyB - 30)); if (bl < 0) { bl = 40; br = W - 40; }
  let eaveY = bodyB - 30; while (eaveY > 0) { const [a, b] = ext(eaveY); if (a >= 0 && b - a > br - bl + 24) break; eaveY--; }
  if (eaveY < 20) eaveY = Math.round(bodyB - (bodyB - 10) * 0.55);
  let [el, er] = ext(Math.max(0, eaveY - 4)); if (el < 0) { el = bl; er = br; }
  const mid = (el + er) / 2; let apexY = 0;
  for (; apexY < eaveY; apexY++) { let hit = false; for (let X = Math.round(mid - 40); X < mid + 40; X++) if (D[(apexY * W + X) * 4 + 3] > 60) { hit = true; break; } if (hit) break; }
  const found = cnt > 150 && dy1 > eaveY;
  const wallH = bodyB - eaveY, dW = Math.max(40, (br - bl) * 0.2);
  const door: [number, number, number, number] = found ? [dx0 - 8, dy0 - 8, dx1 + 8, Math.min(bodyB + 3, dy1 + 8)]
    : [Math.round((bl + br) / 2 - dW / 2), Math.round(bodyB - wallH * 0.55), Math.round((bl + br) / 2 + dW / 2), bodyB + 3];
  // the colours: the most common light colour of the walls (away from the door) and of the roof
  const pick = (y0: number, y1: number, x0: number, x1: number, skip: number[] | null, def: string) => {
    const h: Record<string, number[]> = {};
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, y1); y += 2) for (let X = Math.max(0, Math.round(x0)); X < Math.min(W, x1); X += 2) {
      if (skip && X >= skip[0] && X <= skip[2] && y >= skip[1] && y <= skip[3]) continue;
      const i = (y * W + X) * 4; if (D[i + 3] < 200) continue; const r = D[i], g = D[i + 1], b = D[i + 2]; if (0.3 * r + 0.59 * g + 0.11 * b < 70) continue;
      const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4), q = h[k] || (h[k] = [0, 0, 0, 0]); q[0]++; q[1] += r; q[2] += g; q[3] += b;
    }
    let top: number[] | null = null; for (const k in h) if (!top || h[k][0] > top[0]) top = h[k];
    return top ? '#' + [1, 2, 3].map(j => Math.round(top![j] / top![0]).toString(16).padStart(2, '0')).join('') : def;
  };
  const wall = pick(eaveY + 15, bodyB - 10, bl + 10, br - 10, [door[0] - 10, door[1] - 10, door[2] + 10, door[3] + 10], '#F4C27A');
  const roof = pick(apexY + 30, eaveY - 8, mid - 80, mid + 80, null, '#E4572E');
  const fc = document.createElement('canvas'); fc.width = W; fc.height = H; const fx = fc.getContext('2d')!; fx.drawImage(c, 0, 0);
  const [a, b, cc, d] = door, dc = document.createElement('canvas'); dc.width = Math.max(1, cc - a); dc.height = Math.max(1, d - b);
  const dx = dc.getContext('2d')!; if (!found) { dx.fillStyle = '#8A5A3B'; dx.fillRect(0, 0, dc.width, dc.height); dx.strokeStyle = '#3d2b22'; dx.lineWidth = 6; dx.strokeRect(3, 3, dc.width - 6, dc.height - 6); }
  else dx.drawImage(c, a, b, cc - a, d - b, 0, 0, cc - a, d - b);
  fx.clearRect(a, b, cc - a, d - b);
  return { W, H, fit, src: c, fc, dc, door, found, bodyB, bl, br, eaveY, el, er, apexY, mid, wall, roof };
}

/** Load an image (a scan's object URL or a picture) and read the house in it. */
export function loadHouse(url: string): Promise<HouseShape> {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => { try { res(analyzeHouse(img)); } catch (e) { rej(e); } }; img.onerror = rej; img.src = url; });
}
