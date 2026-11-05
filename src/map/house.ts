// Reading their drawing of the dream house: where its walls, roof and door are, and what colours they are.
// The main door is the dark (brown) coloured patch that looks most like a front door: in the walls, standing on their
// bottom edge, taller than wide, towards the middle. When no clear door is found, one is placed in the middle of the front wall.

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
const lumOf = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
const isBrown = (r: number, g: number, b: number) => { const lum = lumOf(r, g, b); return r > 50 && lum < 110 && g / r > 0.38 && g / r < 0.8 && b / r < 0.66; };
/** A coloured-in dark patch (any dark crayon, not a thin grey pencil line): a door that is not quite brown still counts. */
const isDarkFill = (r: number, g: number, b: number) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return lumOf(r, g, b) < 105 && mx > 40 && (mx - mn) / mx > 0.22; };

/**
 * The drawing fitted into the analysis box, with only the paper *around* the house made transparent. Blank paper
 * inside the house (walls left white, the space between the windows) stays: the house is everything between its
 * outermost lines, row by row and column by column, even where its outline has gaps.
 */
function cutOut(img: CanvasImageSource & { width: number; height: number }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true })!;
  const iw = (img as HTMLImageElement).naturalWidth || img.width, ih = (img as HTMLImageElement).naturalHeight || img.height;
  const k = Math.min((W - 20) / iw, (H - 20) / ih), dw = iw * k, dh = ih * k;
  x.drawImage(img, (W - dw) / 2, H - 10 - dh, dw, dh);
  const id = x.getImageData(0, 0, W, H), D = id.data, N = W * H;
  const paper = (i: number) => { const j = i * 4; if (D[j + 3] < 40) return true; const r = D[j], g = D[j + 1], b = D[j + 2]; return Math.min(r, g, b) > 214 && Math.max(r, g, b) - Math.min(r, g, b) < 30; };
  // the marks, thickened a little (a square of radius R) so the pieces of one house join up
  const ink = new Uint8Array(N); for (let i = 0; i < N; i++) ink[i] = paper(i) ? 0 : 1;
  const R = 6, rowT = new Uint8Array(N), thick = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    let last = -1e9; for (let X = 0; X < W; X++) { if (ink[y * W + X]) last = X; if (X - last <= R) rowT[y * W + X] = 1; }
    last = 1e9; for (let X = W - 1; X >= 0; X--) { if (ink[y * W + X]) last = X; if (last - X <= R) rowT[y * W + X] = 1; }
  }
  for (let X = 0; X < W; X++) {
    let last = -1e9; for (let y = 0; y < H; y++) { if (rowT[y * W + X]) last = y; if (y - last <= R) thick[y * W + X] = 1; }
    last = 1e9; for (let y = H - 1; y >= 0; y--) { if (rowT[y * W + X]) last = y; if (last - y <= R) thick[y * W + X] = 1; }
  }
  // the house: the biggest piece, and the pieces of a fair size with it (a chimney, a step); specks are left out
  const lab = new Int32Array(N), sizes: number[] = [0], st: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!thick[i] || lab[i]) continue; const l = sizes.length; let n = 0; lab[i] = l; st.push(i);
    while (st.length) {
      const q = st.pop()!; n++; const X = q % W, y = (q - X) / W;
      if (X > 0 && thick[q - 1] && !lab[q - 1]) { lab[q - 1] = l; st.push(q - 1); }
      if (X < W - 1 && thick[q + 1] && !lab[q + 1]) { lab[q + 1] = l; st.push(q + 1); }
      if (y > 0 && thick[q - W] && !lab[q - W]) { lab[q - W] = l; st.push(q - W); }
      if (y < H - 1 && thick[q + W] && !lab[q + W]) { lab[q + W] = l; st.push(q + W); }
    }
    sizes.push(n);
  }
  let big = 0; for (let l = 1; l < sizes.length; l++) big = Math.max(big, sizes[l]);
  // inside = between the leftmost and rightmost marks of its row AND between the top and bottom marks of its column
  const rl = new Int32Array(H).fill(W), rr = new Int32Array(H).fill(-1), ct = new Int32Array(W).fill(H), cb = new Int32Array(W).fill(-1);
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const i = y * W + X; if (!ink[i] || !lab[i] || sizes[lab[i]] < big * 0.12) continue;
    if (X < rl[y]) rl[y] = X; if (X > rr[y]) rr[y] = X; if (y < ct[X]) ct[X] = y; if (y > cb[X]) cb[X] = y;
  }
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const i = y * W + X, inside = X >= rl[y] && X <= rr[y] && y >= ct[X] && y <= cb[X];
    if (!inside) D[i * 4 + 3] = 0;
    else if (D[i * 4 + 3] < 40) { D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = 255; D[i * 4 + 3] = 255; } // blank paper inside the house stays, as paper
  }
  x.putImageData(id, 0, 0); return { c, D, fit: [(W - dw) / 2, H - 10 - dh, dw, dh] as [number, number, number, number] };
}

export function analyzeHouse(img: CanvasImageSource & { width: number; height: number }): HouseShape {
  const { c, D, fit } = cutOut(img);
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

  // The main door: of the patches coloured in dark (brown first), the one that looks most like a front door —
  // in the walls (not the roof), standing on the bottom of the walls, taller than wide, towards the middle.
  // Windows are higher up and squarer; a brown roof or a tree trunk beside the house is outside the walls.
  const CS = 10, CW = Math.ceil(W / CS), CH = Math.ceil(H / CS), cnt = new Uint16Array(CW * CH);
  const doorish = (j: number) => D[j + 3] >= 200 && (isBrown(D[j], D[j + 1], D[j + 2]) || isDarkFill(D[j], D[j + 1], D[j + 2]));
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) if (doorish((y * W + X) * 4)) cnt[Math.floor(X / CS) + Math.floor(y / CS) * CW]++;
  const dense = (q: number) => cnt[q] >= CS * CS * 0.3;
  const seen = new Uint8Array(CW * CH), wallH = Math.max(1, bodyB - eaveY), wallW = Math.max(1, br - bl);
  let best: { box: [number, number, number, number]; score: number } | null = null;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !dense(i)) continue; const grp: number[] = [], stk = [i]; seen[i] = 1;
    while (stk.length) {
      const q = stk.pop()!; grp.push(q); const cx = q % CW, cy = (q / CW) | 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const nx = cx + a, ny = cy + b; if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue; const j = ny * CW + nx; if (!seen[j] && dense(j)) { seen[j] = 1; stk.push(j); } }
    }
    // its exact box, from its own pixels
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0, nb = 0;
    for (const q of grp) {
      const cx = q % CW, cy = (q / CW) | 0;
      for (let y = cy * CS; y < Math.min(H, cy * CS + CS); y++) for (let X = cx * CS; X < Math.min(W, cx * CS + CS); X++) {
        const j = (y * W + X) * 4; if (!doorish(j)) continue; n++; if (isBrown(D[j], D[j + 1], D[j + 2])) nb++;
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (n < 150) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cx = (x0 + x1) / 2;
    // a door is in the walls, below the eaves, and not wider than most of the front
    if (y1 < eaveY + wallH * 0.3 || cx < bl - 10 || cx > br + 10 || w > wallW * 0.7) continue;
    const ground = 1 - Math.min(1, Math.abs(bodyB - y1) / (wallH * 0.45));      // stands on the bottom of the walls
    const tall = h / w, shape = tall >= 1 ? Math.max(0, 1 - Math.abs(tall - 1.8) / 2.2) : Math.max(0, tall - 0.5) * 0.6; // taller than wide
    const centre = 1 - Math.min(1, Math.abs(cx - (bl + br) / 2) / (wallW / 2));   // front doors are usually towards the middle
    const inWalls = Math.min(1, Math.max(0, (y0 - eaveY) / wallH + 0.4));         // starts in the walls, not up in the roof
    const size = Math.min(1, (w * h) / (wallW * wallH * 0.08));                   // big enough to walk through
    const score = (ground * 3 + shape * 2 + centre + inWalls + size * 1.2) * (nb > n * 0.5 ? 1.35 : 1) * (0.6 + 0.4 * Math.min(1, n / (w * h)));
    if (!best || score > best.score) best = { box: [x0, y0, x1, y1], score };
  }
  const found = !!best && best.score > 2.4;
  const dW = Math.max(40, (br - bl) * 0.2);
  const door: [number, number, number, number] = best && found ? [best.box[0] - 8, best.box[1] - 8, best.box[2] + 8, Math.min(bodyB + 3, best.box[3] + 8)]
    : [Math.round((bl + br) / 2 - dW / 2), Math.round(bodyB - wallH * 0.55), Math.round((bl + br) / 2 + dW / 2), bodyB + 3];
  // the colours: the most common light colour of the walls (away from the door) and of the roof
  const pick = (y0: number, y1: number, x0: number, x1: number, skip: number[] | null, def: string) => {
    const h: Record<string, number[]> = {};
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, y1); y += 2) for (let X = Math.max(0, Math.round(x0)); X < Math.min(W, x1); X += 2) {
      if (skip && X >= skip[0] && X <= skip[2] && y >= skip[1] && y <= skip[3]) continue;
      const i = (y * W + X) * 4; if (D[i + 3] < 200) continue; const r = D[i], g = D[i + 1], b = D[i + 2]; if (lumOf(r, g, b) < 70) continue;
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
