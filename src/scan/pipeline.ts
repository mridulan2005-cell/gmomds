// Scan pipeline: photo → flat paper → ink → {f, s} paths in a 64×64 box.
// Pure functions on RGBA buffers so it runs in a Web Worker and in tests.
// Nothing here redraws a drawing: every path is traced from the person's own lines.

export interface Img { width: number; height: number; data: Uint8ClampedArray }
export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // tl, tr, br, bl

export interface Vector {
  f: string[]; s: string[]; fc: (string | null)[];
  /** Exact cut-out of the whole drawing (outer outlines and holes), in the 64 box: what gets extruded into 3D. */
  sil?: { outer: string[]; holes: string[] };
  /** The drawing itself, white-balanced, covering artBox [x0, y0, x1, y1] of the 64 box: printed on the 3D cut-out. */
  art?: Img; artBox?: [number, number, number, number];
}
export type ScanError = 'empty' | 'blurry' | 'no-paper' | 'not-drawing';
export interface ScanResult {
  ok: boolean;
  error?: ScanError;
  quad: Quad | null;
  crop?: Img;      // colour crop of the ink area on the flattened paper (for the scrapbook + Claude)
  ink?: Img;       // ink only, on transparent (for previews)
  vector?: Vector;
  sharpness?: number;
}

// ---------- small helpers ----------
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function toGray(img: Img): Float32Array {
  const { data, width, height } = img, g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255;
  return g;
}

export function resize(img: Img, maxSide: number): Img {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s >= 1) return img;
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4), k = 1 / s;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // box filter over the source pixels covered by this output pixel
    const x0 = Math.floor(x * k), x1 = Math.min(img.width, Math.floor((x + 1) * k)), y0 = Math.floor(y * k), y1 = Math.min(img.height, Math.floor((y + 1) * k));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < Math.max(y1, y0 + 1); yy++) for (let xx = x0; xx < Math.max(x1, x0 + 1); xx++) {
      const j = (yy * img.width + xx) * 4; r += img.data[j]; g += img.data[j + 1]; b += img.data[j + 2]; a += img.data[j + 3]; n++;
    }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return { width: w, height: h, data: out };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; }
  }
  return out;
}

function otsu(g: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[clamp(Math.round(g[i] * 255), 0, 255)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr / 255;
}

// Binary morphology on Uint8 masks (square structuring element, separable).
function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; const row = y * w;
    for (let x = 0; x < w; x++) { if (m[row + x]) last = x; if (x - last <= r) t[row + x] = 1; }
    last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[row + x]) last = x; if (last - x <= r) t[row + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9;
    for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; }
    last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o;
}
function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = dilate(inv, w, h, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1; return d;
}

/** 8-connected component labelling. Returns labels (0 = none) and per-label pixel counts (index = label). */
export function label(m: Uint8Array, w: number, h: number, conn8 = true): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(w * h), sizes = [0], stack: number[] = [];
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    n++; let c = 0; lab[i] = n; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w; c++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (m[q] && !lab[q]) { lab[q] = n; stack.push(q); }
      }
    }
    sizes.push(c);
  }
  return { lab, sizes };
}

/** Two-pass chamfer distance (to nearest 0 pixel), in pixels. */
function distance(m: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, d = new Float32Array(w * h), a = 1, b = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a); if (y > 0) { v = Math.min(v, d[i - w] + a); if (x > 0) v = Math.min(v, d[i - w - 1] + b); if (x < w - 1) v = Math.min(v, d[i - w + 1] + b); } d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + a); if (y < h - 1) { v = Math.min(v, d[i + w] + a); if (x < w - 1) v = Math.min(v, d[i + w + 1] + b); if (x > 0) v = Math.min(v, d[i + w - 1] + b); } d[i] = v; }
  for (let i = 0; i < d.length; i++) if (d[i] >= INF) d[i] = Math.max(w, h);
  return d;
}

// ---------- 1. paper detection ----------
function cross(o: Pt, a: Pt, b: Pt) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function hull(pts: Pt[]): Pt[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function polyArea(p: Pt[]) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; }

/** Reduce a convex polygon to its best-fitting quadrilateral by repeatedly dropping the cheapest vertex. */
function toQuad(h: Pt[]): Pt[] {
  const p = h.slice();
  while (p.length > 4) {
    let bi = 0, bc = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const cost = Math.abs(cross(a, b, c)) / 2; if (cost < bc) { bc = cost; bi = i; }
    }
    p.splice(bi, 1);
  }
  return p;
}
/**
 * Four corners from the sheet's four straight sides, extended to meet. A hand over a corner cuts it off the
 * outline; the sides still point to where the hidden corner is. Falls back to toQuad when the sides are unclear.
 */
function sidesQuad(h: Pt[]): Pt[] {
  const n = h.length, ang = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  // merge runs of nearly straight hull edges into sides
  const sides: { a: Pt; b: Pt; len: number; at: number }[] = [];
  let start = 0; for (let i = 1; i < n; i++) if (turn(ang(h[i - 1], h[i]), ang(h[i], h[(i + 1) % n])) > 0.35) { start = i; break; }
  let a = h[start], dir = ang(h[start], h[(start + 1) % n]);
  for (let k = 1; k <= n; k++) {
    const p = h[(start + k) % n], q = h[(start + k + 1) % n];
    if (k === n || turn(dir, ang(p, q)) > 0.35) { sides.push({ a, b: p, len: Math.hypot(p[0] - a[0], p[1] - a[1]), at: k }); a = p; dir = ang(p, q); }
  }
  if (sides.length < 4) return toQuad(h);
  const four = sides.slice().sort((x, y) => y.len - x.len).slice(0, 4).sort((x, y) => x.at - y.at);
  const meet = (s: typeof four[0], t: typeof four[0]): Pt | null => {
    const [x1, y1] = s.a, [x2, y2] = s.b, [x3, y3] = t.a, [x4, y4] = t.b, d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 1e-6) return null;
    const u = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return [x1 + u * (x2 - x1), y1 + u * (y2 - y1)];
  };
  const q = four.map((s, i) => meet(four[(i + 3) % 4], s));
  if (q.some(p => !p)) return toQuad(h);
  const qa = polyArea(q as Pt[]), ha = polyArea(h);
  // the four longest sides must carry most of the outline, and the corners must not fly off
  const share = four.reduce((t, s) => t + s.len, 0) / sides.reduce((t, s) => t + s.len, 0);
  if (share < 0.75 || qa < ha * 0.95 || qa > ha * 1.35) return toQuad(h);
  return q as Pt[];
}

function orderQuad(p: Pt[]): Quad {
  const cx = p.reduce((s, q) => s + q[0], 0) / 4, cy = p.reduce((s, q) => s + q[1], 0) / 4;
  const s = p.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); // clockwise in image coords
  let k = 0; for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
  return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]] as Quad;
}

// What is paper and what is not. Old hands and small hands hold the sheet, and the table, the floor or a lap
// is in view too: only the sheet (and what is drawn on it) may become part of the drawing.

/** Per-channel white level (95th percentile), to divide out the colour of the light. */
function whiteLevel(img: Img): [number, number, number] {
  const out: number[] = [];
  for (let c = 0; c < 3; c++) { const v: number[] = []; for (let j = c; j < img.data.length; j += 4 * 5) v.push(img.data[j]); v.sort((a, b) => a - b); out.push(Math.max(40, v[Math.floor(v.length * 0.95)] || 255)); }
  return out as [number, number, number];
}
/** Skin, on white-balanced colour. Two common rules (RGB and YCbCr), so light and dark skin both count. */
function skinAt(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && r - g > 15 && r > b) return true;
  const y = 0.299 * r + 0.587 * g + 0.114 * b, cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b, cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
  return y > 35 && cr >= 135 && cr <= 180 && cb >= 85 && cb <= 135 && r > b;
}
interface Classes { w: number; h: number; paper: Uint8Array; skin: Uint8Array; grey: Uint8Array }
/** Per pixel: paper (bright and colourless once the light's colour is removed, not skin), skin, and soft grey (shadows). */
function classify(img: Img): Classes {
  const { width: w, height: h, data } = img, wl = whiteLevel(img), n = w * h;
  const g = new Float32Array(n), sat = new Float32Array(n), skin = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = Math.min(255, (data[j] * 255) / wl[0]), gg = Math.min(255, (data[j + 1] * 255) / wl[1]), b = Math.min(255, (data[j + 2] * 255) / wl[2]);
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    g[i] = (0.299 * r + 0.587 * gg + 0.114 * b) / 255; sat[i] = mx ? (mx - mn) / mx : 0; skin[i] = skinAt(r, gg, b) ? 1 : 0;
  }
  const t = Math.max(otsu(g), 0.5), paper = new Uint8Array(n), grey = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    paper[i] = g[i] > t && sat[i] < 0.22 && !skin[i] ? 1 : 0;
    grey[i] = !paper[i] && !skin[i] && sat[i] < 0.25 && g[i] > 0.3 ? 1 : 0;
  }
  return { w, h, paper, skin, grey };
}

/** The sheet: the bright, colourless region that is biggest and nearest the middle of the view. */
function sheet(c: Classes): { m: Uint8Array; size: number } | null {
  const { w, h } = c;
  let m = erode(dilate(c.paper, w, h, 2), w, h, 2); // close over pencil lines
  m = dilate(erode(m, w, h, 1), w, h, 1); // open away thin bright bits
  const { lab, sizes } = label(m, w, h, false), score = new Float64Array(sizes.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[y * w + x]; if (!l) continue;
    score[l] += 1 - Math.min(0.9, Math.hypot((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5) * 1.4);
  }
  let best = 0; for (let l = 1; l < sizes.length; l++) if (score[l] > score[best]) best = l;
  if (!best || sizes[best] < w * h * 0.08) return null;
  const o = new Uint8Array(w * h); for (let i = 0; i < o.length; i++) if (lab[i] === best) o[i] = 1;
  return { m: o, size: sizes[best] };
}

function outline(m: Uint8Array, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!m[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) pts.push([x + 0.5, y + 0.5]);
  }
  return pts;
}

function touchesBorder(lab: Int32Array, w: number, h: number): Set<number> {
  const s = new Set<number>();
  for (let x = 0; x < w; x++) { s.add(lab[x]); s.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { s.add(lab[y * w]); s.add(lab[y * w + w - 1]); }
  s.delete(0); return s;
}

export interface Sheet { quad: Quad | null; hands: boolean }

/**
 * Find the sheet of paper (four corners) and whether hands are over it. Hands, a lap or a busy table are not paper,
 * and a hand over a corner does not cut the corner off (the corners come from the sheet's convex outline).
 * quad is null when no clear sheet is found, for example when the paper fills the whole view.
 */
export function detectSheet(img: Img): Sheet {
  const small = resize(img, 240), c = classify(small), { w, h } = c, s = sheet(c);
  let quad: Quad | null = null, poly: Pt[] | null = null;
  if (s) {
    // if the sheet hugs most of the frame border, the paper fills the view: no outline to find
    let border = 0, perim = 0;
    const onB = (x: number, y: number) => { perim++; if (s.m[y * w + x]) border++; };
    for (let x = 0; x < w; x++) { onB(x, 0); onB(x, h - 1); } for (let y = 1; y < h - 1; y++) { onB(0, y); onB(w - 1, y); }
    const hp = border / perim > 0.6 ? [] : hull(outline(s.m, w, h));
    if (hp.length >= 4) {
      const q = sidesQuad(hp), qa = polyArea(q);
      if (qa >= w * h * 0.1 && qa >= polyArea(hp) * 0.85) { poly = q; const sx = img.width / w, sy = img.height / h; quad = orderQuad(q.map(([x, y]) => [x * sx, y * sy] as Pt)); }
    }
  }
  // hands: skin that reaches in over the sheet from outside it
  const inner: Pt[] = poly
    ? (() => { const cx = poly.reduce((a, p) => a + p[0], 0) / 4, cy = poly.reduce((a, p) => a + p[1], 0) / 4; return poly.map(([x, y]) => [cx + (x - cx) * 0.88, cy + (y - cy) * 0.88] as Pt); })()
    : [[w * 0.12, h * 0.12], [w * 0.88, h * 0.12], [w * 0.88, h * 0.88], [w * 0.12, h * 0.88]];
  const sk = label(c.skin, w, h), edge = touchesBorder(sk.lab, w, h), inside = new Float64Array(sk.sizes.length), outsideN = new Float64Array(sk.sizes.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = sk.lab[y * w + x]; if (!l || sk.sizes[l] < w * h * 0.004) continue;
    if (pointInPoly(x + 0.5, y + 0.5, inner)) inside[l]++; else outsideN[l]++;
  }
  const innerArea = polyArea(inner); let hands = false;
  for (let l = 1; l < sk.sizes.length; l++) if (inside[l] > innerArea * 0.004 && (edge.has(l) || outsideN[l] > 0)) hands = true;
  return { quad, hands };
}

/** Find the sheet of paper: four corners, or null when no clear sheet is found. */
export function detectPaper(img: Img): Quad | null { return detectSheet(img).quad; }

/**
 * Where a drawing can be: the sheet and the marks on it. Hands (skin, and the shadows they cast, reaching in
 * from the edge), the background, and anything else that reaches in from outside the sheet are left out.
 * Returns a mask the size of img.
 */
export function drawingArea(img: Img): Uint8Array {
  const small = resize(img, 320), c = classify(small), { w, h } = c, s = sheet(c), W = img.width, H = img.height;
  const area = new Uint8Array(W * H);
  if (!s) { area.fill(1); return area; }
  const P = s.m, hp = hull(outline(P, w, h));
  const inHull = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inHull[y * w + x] = hp.length >= 3 && pointInPoly(x + 0.5, y + 0.5, hp) ? 1 : 0;
  const shadow = dilate(erode(c.grey, w, h, 2), w, h, 2); // thick soft grey, not thin pencil lines
  // flood in from the edge of the view: anything outside the sheet, and over the sheet only hands and their shadows
  const out = new Uint8Array(w * h), pass = (i: number) => !P[i] && (!inHull[i] || c.skin[i] || shadow[i]), st: number[] = [];
  const seed = (i: number) => { if (!out[i] && pass(i)) { out[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (st.length) {
    const i = st.pop()!, x = i % w, y = (i - x) / w;
    if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
  }
  const gone = dilate(out, w, h, 2);
  // what is left that is not the sheet: marks on it. Those still reaching the edge of the view (a sleeve, the table)
  // go, and so do bits surrounded by a hand rather than by paper (a fingernail, a crease).
  const rest = new Uint8Array(w * h); for (let i = 0; i < rest.length; i++) rest[i] = !P[i] && !gone[i] ? 1 : 0;
  const rl = label(rest, w, h), edge = touchesBorder(rl.lab, w, h), byHand = new Float64Array(rl.sizes.length), byPaper = new Float64Array(rl.sizes.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = rl.lab[y * w + x]; if (!l) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx;
      if (gone[j]) byHand[l]++; else if (P[j]) byPaper[l]++;
    }
  }
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < ok.length; i++) { const l = rl.lab[i]; ok[i] = !gone[i] && (P[i] || (l && !edge.has(l) && byPaper[l] >= byHand[l])) ? 1 : 0; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) area[y * W + x] = ok[Math.min(h - 1, Math.floor((y * h) / H)) * w + Math.min(w - 1, Math.floor((x * w) / W))];
  return area;
}

// ---------- 2. perspective correction ----------
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
/** Homography mapping dst points → src points. */
function homography(dst: Pt[], src: Pt[]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}
export function warp(img: Img, q: Quad, maxSide = 1000): Img {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(d(q[0], q[1]), d(q[3], q[2])), H = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const s = Math.min(1, maxSide / Math.max(W, H)); W = Math.max(8, Math.round(W * s)); H = Math.max(8, Math.round(H * s));
  const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], q), out = new Uint8ClampedArray(W * H * 4), sw = img.width, sh = img.height, sd = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = x + 0.5, Y = y + 0.5, z = Hm[6] * X + Hm[7] * Y + 1;
    const u = clamp((Hm[0] * X + Hm[1] * Y + Hm[2]) / z - 0.5, 0, sw - 1.001), v = clamp((Hm[3] * X + Hm[4] * Y + Hm[5]) / z - 0.5, 0, sh - 1.001);
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, o = (y * W + x) * 4;
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let c = 0; c < 4; c++) out[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
  }
  return { width: W, height: H, data: out };
}

// ---------- 3. ink extraction ----------
/** Paper brightness estimate: max-filter at low resolution, then blur. Removes shadows and uneven light. */
function background(g: Float32Array, w: number, h: number): Float32Array {
  const f = 8, sw = Math.ceil(w / f), sh = Math.ceil(h / f), s = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let mx = 0; for (let yy = y * f; yy < Math.min(h, y * f + f); yy++) for (let xx = x * f; xx < Math.min(w, x * f + f); xx++) mx = Math.max(mx, g[yy * w + xx]);
    s[y * sw + x] = mx;
  }
  const r = Math.max(2, Math.round(Math.max(sw, sh) / 14)), m = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { // local max (radius r)
    let mx = 0; for (let yy = Math.max(0, y - r); yy <= Math.min(sh - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(sw - 1, x + r); xx++) mx = Math.max(mx, s[yy * sw + xx]);
    m[y * sw + x] = mx;
  }
  const bl = boxBlur(m, sw, sh, Math.max(1, r >> 1)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { // bilinear upsample
    const u = clamp((x + 0.5) / f - 0.5, 0, sw - 1), v = clamp((y + 0.5) / f - 0.5, 0, sh - 1), x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = u - x0, fy = v - y0;
    out[y * w + x] = (bl[y0 * sw + x0] * (1 - fx) + bl[y0 * sw + x1] * fx) * (1 - fy) + (bl[y1 * sw + x0] * (1 - fx) + bl[y1 * sw + x1] * fx) * fy;
  }
  return out;
}

function saturation(d: Uint8ClampedArray, j: number) { const mx = Math.max(d[j], d[j + 1], d[j + 2]), mn = Math.min(d[j], d[j + 1], d[j + 2]); return mx ? (mx - mn) / mx : 0; }

/** Marks on the paper (pencil, pen and crayon) as a binary mask. */
export function inkMask(paper: Img): Uint8Array {
  const { width: w, height: h, data } = paper, g = toGray(paper), bg = background(g, w, h), m = new Uint8Array(w * h);
  // a big coloured-in area can fool the local estimate; paper is never much darker than the sheet's bright level
  const sorted = Float32Array.from(g.filter((_, i) => i % 7 === 0)).sort(), p90 = sorted[Math.floor(sorted.length * 0.9)] || 1;
  for (let i = 0; i < bg.length; i++) bg[i] = Math.max(bg[i], p90 * 0.85);
  for (let i = 0, j = 0; i < m.length; i++, j += 4) {
    const r = g[i] / Math.max(0.15, bg[i]);
    m[i] = r < 0.72 || (saturation(data, j) > 0.3 && g[i] < p90 * 0.96) ? 1 : 0; // pencil/pen, or crayon colour
  }
  // ignore a thin margin, where the paper edge and the tray can creep in
  const mx = Math.round(w * 0.025), my = Math.round(h * 0.025);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < mx || y < my || x >= w - mx || y >= h - my) m[y * w + x] = 0;
  return m;
}

function despeckle(m: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const { lab, sizes } = label(m, w, h), o = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) if (lab[i] && sizes[lab[i]] >= minArea) o[i] = 1;
  return o;
}

/**
 * Keep only the drawing: drop marks that touch the paper's edge (shadows, the tray, the table) and
 * small stray specks far away from the drawing (smudges, a crease), unless they are a big part of it.
 */
export function onlyDrawing(m: Uint8Array, w: number, h: number): Uint8Array {
  const { lab, sizes } = label(m, w, h), n = sizes.length;
  if (n <= 1) return m;
  const box = Array.from({ length: n }, () => ({ x0: w, y0: h, x1: -1, y1: -1 })), edge = new Uint8Array(n), b = Math.round(Math.max(w, h) * 0.03) + 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[y * w + x]; if (!l) continue; const r = box[l];
    if (x < r.x0) r.x0 = x; if (x > r.x1) r.x1 = x; if (y < r.y0) r.y0 = y; if (y > r.y1) r.y1 = y;
    if (x < b || y < b || x >= w - b || y >= h - b) edge[l] = 1;
  }
  // an edge mark goes when it is a thin strip along the edge, or small next to the drawing in the middle
  let inner = 0; for (let l = 1; l < n; l++) if (!edge[l]) inner = Math.max(inner, sizes[l]);
  const keep = new Uint8Array(n);
  for (let l = 1; l < n; l++) {
    const r = box[l], strip = Math.min(r.x1 - r.x0, r.y1 - r.y0) < Math.max(w, h) * 0.06;
    keep[l] = edge[l] && inner && (strip || sizes[l] < inner * 0.35) ? 0 : 1;
  }
  let total = 0; for (let l = 1; l < n; l++) if (keep[l]) total += sizes[l];
  // the main drawing: every kept mark that is a real part of it
  let mx0 = w, my0 = h, mx1 = -1, my1 = -1;
  for (let l = 1; l < n; l++) if (keep[l] && sizes[l] >= total * 0.03) { const r = box[l]; mx0 = Math.min(mx0, r.x0); my0 = Math.min(my0, r.y0); mx1 = Math.max(mx1, r.x1); my1 = Math.max(my1, r.y1); }
  if (mx1 >= 0) {
    const reach = Math.max(mx1 - mx0, my1 - my0, Math.max(w, h) * 0.1) * 0.2;
    for (let l = 1; l < n; l++) {
      if (!keep[l] || sizes[l] >= total * 0.03) continue;
      const r = box[l], dx = Math.max(0, mx0 - r.x1, r.x0 - mx1), dy = Math.max(0, my0 - r.y1, r.y0 - my1);
      if (Math.hypot(dx, dy) > reach) keep[l] = 0;
    }
  }
  const o = new Uint8Array(w * h);
  for (let i = 0; i < o.length; i++) if (lab[i] && keep[lab[i]]) o[i] = 1;
  return o;
}

function bbox(m: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function cropImg(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

/** Edge sharpness: mean gradient across ink edges, relative to the ink contrast. Low = blurry photo. */
function sharpness(g: Float32Array, m: Uint8Array, w: number, h: number): number {
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!m[i] || (m[i - 1] && m[i + 1] && m[i - w] && m[i + w])) continue;
    const gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w]; sum += Math.hypot(gx, gy); n++;
  }
  return n ? sum / n : 0;
}

// ---------- 4. vectorise ----------
/** Zhang–Suen thinning. */
export function skeleton(src: Uint8Array, w: number, h: number): Uint8Array {
  const m = src.slice(), del: number[] = [];
  const P = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]; let A = 0; for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) m[i] = 0; }
    }
  }
  return m;
}

const N8: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** Walk a skeleton into polylines (pixel centres). */
export function traceSkeleton(sk: Uint8Array, w: number, h: number): Pt[][] {
  const deg = new Uint8Array(w * h);
  const nb = (i: number) => { const x = i % w, y = (i - x) / w, r: number[] = []; for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) r.push(ny * w + nx); } return r; };
  for (let i = 0; i < sk.length; i++) if (sk[i]) deg[i] = nb(i).length;
  const used = new Set<string>(), key = (a: number, b: number) => (a < b ? a + ',' + b : b + ',' + a), lines: Pt[][] = [];
  const pt = (i: number): Pt => [i % w + 0.5, Math.floor(i / w) + 0.5];
  const walk = (start: number, next: number) => {
    const line = [pt(start)]; let prev = start, cur = next; used.add(key(prev, cur));
    for (;;) {
      line.push(pt(cur));
      if (deg[cur] !== 2) break; // endpoint or junction
      const n = nb(cur).filter(q => q !== prev && !used.has(key(cur, q)));
      if (!n.length) break;
      // prefer 4-neighbours to stay on the line
      n.sort((a, b) => (Math.abs(a - cur) === 1 || Math.abs(a - cur) === w ? 0 : 1) - (Math.abs(b - cur) === 1 || Math.abs(b - cur) === w ? 0 : 1));
      prev = cur; cur = n[0]; used.add(key(prev, cur));
      if (cur === start) { line.push(pt(cur)); break; }
    }
    return line;
  };
  for (let i = 0; i < sk.length; i++) if (sk[i] && deg[i] !== 2) for (const q of nb(i)) if (!used.has(key(i, q))) lines.push(walk(i, q));
  for (let i = 0; i < sk.length; i++) if (sk[i] && deg[i] === 2) for (const q of nb(i)) if (!used.has(key(i, q))) lines.push(walk(i, q)); // loops
  for (let i = 0; i < sk.length; i++) if (sk[i] && deg[i] === 0) lines.push([pt(i)]); // dots
  return lines;
}

/** Outer boundary of one labelled region (Moore-neighbour tracing). */
function traceContour(lab: Int32Array, w: number, h: number, id: number): Pt[] {
  let start = -1; for (let i = 0; i < lab.length; i++) if (lab[i] === id) { start = i; break; }
  if (start < 0) return [];
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === id;
  const D: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let x = start % w, y = (start - x) / w, dir = 7; const sx = x, sy = y, out: Pt[] = [];
  for (let guard = 0; guard < w * h * 4; guard++) {
    out.push([x + 0.5, y + 0.5]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8, nx = x + D[d][0], ny = y + D[d][1];
      if (inR(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
    }
    if (!found || (x === sx && y === sy)) break;
  }
  return out;
}

function chaikin(p: Pt[], closed: boolean, iters = 1): Pt[] {
  let pts = p;
  for (let it = 0; it < iters; it++) {
    if (pts.length < 3) return pts;
    const o: Pt[] = closed ? [] : [pts[0]], n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) o.push(pts[n - 1]);
    pts = o;
  }
  return pts;
}

export function rdp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!; let md = 0, mi = -1;
    const [ax, ay] = p[a], [bx, by] = p[b], L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - p[i][1]) - (ax - p[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
function rdpClosed(p: Pt[], eps: number): Pt[] {
  if (p.length < 6) return p;
  let far = 0, fd = 0; for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp(p.slice(far).concat([p[0]]), eps);
  return a.concat(b.slice(1, -1));
}
function capPoints(p: Pt[], max: number): Pt[] { if (p.length <= max) return p; const step = p.length / max, o: Pt[] = []; for (let i = 0; i < max; i++) o.push(p[Math.floor(i * step)]); return o; }
function pathLen(p: Pt[]) { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; }
function pointInPoly(x: number, y: number, poly: Pt[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/**
 * Turn an ink mask into puffy regions (f) and pencil strokes (s), normalised into the 64×64 box.
 * The drawing is centred horizontally and stands on y = 60 (the island surface in the 3D map).
 */
export function vectorise(mask: Uint8Array, mw: number, mh: number, colour?: Img): Vector {
  const work = 180, s = work / Math.max(mw, mh), w = Math.max(4, Math.round(mw * s)), h = Math.max(4, Math.round(mh * s));
  // area-coverage downsample of the mask, keeping thin lines
  const cov = new Float32Array(w * h), cnt = new Float32Array(w * h);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const j = Math.min(h - 1, Math.floor(y * s)) * w + Math.min(w - 1, Math.floor(x * s)); cnt[j]++; if (mask[y * mw + x]) cov[j]++; }
  let M: Uint8Array = new Uint8Array(w * h); for (let i = 0; i < M.length; i++) M[i] = cnt[i] && cov[i] / cnt[i] > 0.2 ? 1 : 0;
  M = despeckle(M, w, h, 3);
  const area = w * h;

  // closed regions: holes enclosed by lines (gaps up to ~6px sealed), plus thick coloured-in areas
  const closed = erode(dilate(M, w, h, 3), w, h, 3);
  const bgLab = label(closed.map(v => (v ? 0 : 1)) as Uint8Array, w, h, false);
  const touches = new Set<number>();
  for (let x = 0; x < w; x++) { touches.add(bgLab.lab[x]); touches.add(bgLab.lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { touches.add(bgLab.lab[y * w]); touches.add(bgLab.lab[y * w + w - 1]); }
  // Each enclosed hole is its own region, so a beak, wing or tail stays a separate puffy piece.
  const dist = distance(M, w, h), L = new Int32Array(w * h), remap = new Map<number, number>();
  let nl = 0;
  for (let i = 0; i < L.length; i++) {
    const l = bgLab.lab[i]; if (!l || touches.has(l) || bgLab.sizes[l] <= area * 0.004) continue;
    let r = remap.get(l); if (!r) { r = ++nl; remap.set(l, r); } L[i] = r;
  }
  const grow = (n: number, from = 1) => {
    for (let it = 0; it < n; it++) {
      const prev = L.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (prev[i]) continue;
        for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = prev[ny * w + nx]; if (q >= from) { L[i] = q; break; } }
      }
    }
  };
  grow(3); // out to the outer edge of the outline
  // thick coloured-in areas: join the region they overlap, or become their own region
  // dark heavy marks (eyes, dots) stay pencil marks; lighter coloured-in areas become regions
  const dark = new Uint8Array(w * h);
  if (colour) { const cs = colour.width / w; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = (Math.min(colour.height - 1, Math.floor((y + 0.5) * cs)) * colour.width + Math.min(colour.width - 1, Math.floor((x + 0.5) * cs))) * 4; if ((colour.data[j] + colour.data[j + 1] + colour.data[j + 2]) / 765 < 0.4 && saturation(colour.data, j) < 0.5) dark[y * w + x] = 1; } }
  const core = new Uint8Array(w * h); for (let i = 0; i < core.length; i++) if (dist[i] >= 3.2 && !dark[i]) core[i] = 1;
  const cl = label(core, w, h), join = new Map<number, number>(), nl0 = nl;
  for (let i = 0; i < core.length; i++) { const c = cl.lab[i]; if (c && L[i] && !join.has(c)) join.set(c, L[i]); }
  for (let i = 0; i < core.length; i++) { const c = cl.lab[i]; if (!c) continue; if (!join.has(c)) join.set(c, ++nl); if (!L[i]) L[i] = join.get(c)!; }
  const firstCore = nl0 + 1; grow(3, firstCore);
  const fillPolys: Pt[][] = [], fillIds: number[] = [], counts = new Array(nl + 1).fill(0);
  for (let i = 0; i < L.length; i++) counts[L[i]]++;
  for (let id = 1; id <= nl; id++) {
    if (counts[id] < area * 0.006) continue;
    const c = traceContour(L, w, h, id); if (c.length < 8) continue;
    const poly = capPoints(rdpClosed(chaikin(c, true, 2), 0.9), 90);
    if (poly.length >= 3 && polyArea(poly) > area * 0.004) { fillPolys.push(poly); fillIds.push(id); }
  }
  const keep = new Set(fillIds), fillMask = new Uint8Array(w * h); for (let i = 0; i < L.length; i++) if (keep.has(L[i])) fillMask[i] = 1;

  // open strokes: centre lines, minus the parts that are already a fill outline or inside thick colour
  // pencil lines = ink minus coloured-in areas, so an eye drawn on a crayon body is still its own mark
  const lineInk = M.map((v, i) => (v && !core[i] ? 1 : 0)) as Uint8Array;
  const sk = skeleton(lineInk, w, h);
  // treat marks fully inside a region (eyes, stripes) as inside it
  const solid = fillMask.slice(), outer = label(fillMask.map(v => (v ? 0 : 1)) as Uint8Array, w, h, false), edgeL = new Set<number>();
  for (let x = 0; x < w; x++) { edgeL.add(outer.lab[x]); edgeL.add(outer.lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { edgeL.add(outer.lab[y * w]); edgeL.add(outer.lab[y * w + w - 1]); }
  for (let i = 0; i < solid.length; i++) if (!solid[i] && !edgeL.has(outer.lab[i])) solid[i] = 1;
  const fd = distance(solid.map(v => (v ? 0 : 1)) as Uint8Array, w, h); // distance to a fill (0 inside)
  const insideDepth = distance(solid, w, h); // depth inside a fill
  const edge = new Uint8Array(w * h); // borders between two touching regions are outlines too
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (L[i] && keep.has(L[i]) && ((x + 1 < w && L[i + 1] && L[i + 1] !== L[i]) || (y + 1 < h && L[i + w] && L[i + w] !== L[i]))) edge[i] = 1; }
  const edgeDist = distance(edge.map(v => (v ? 0 : 1)) as Uint8Array, w, h);
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i]) continue;
    if (core[i]) sk[i] = 0; // coloured area
    else if (solid[i] && (insideDepth[i] <= 3.5 || edgeDist[i] <= 2.5)) sk[i] = 0; // on a fill's outline band
    else if (!solid[i] && fd[i] <= 2) sk[i] = 0;
  }
  let lines = traceSkeleton(sk, w, h);
  const minLen = Math.max(w, h) * 0.035;
  // drop spurs and specks; keep small isolated marks (eyes, dots)
  // a short mark is kept only when it is a mark of its own on the paper (an eye, a dot), not a leftover piece of an outline
  const inkLab = label(lineInk, w, h), markMax = minLen * minLen * 1.5;
  const ownMark = (l: Pt[]) => { const [x, y] = l[0]; const c = inkLab.lab[Math.floor(y) * w + Math.floor(x)]; return !!c && inkLab.sizes[c] <= markMax; };
  lines = lines.filter(l => pathLen(l) >= minLen || ownMark(l));
  let strokes = lines.map(l => capPoints(rdp(chaikin(l, false, 2), 0.9), 70)).filter(l => l.length);
  // total budget so 3D generation stays fast
  strokes.sort((a, b) => pathLen(b) - pathLen(a)); strokes = strokes.slice(0, 40);

  // normalise to the 64 box
  const bb = bbox(M, w, h) || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, k = 56 / Math.max(bw, bh);
  const ox = 32 - (bb.x0 + bw / 2) * k, oy = 60 - (bb.y1 + 1) * k;
  const T = (p: Pt): string => (p[0] * k + ox).toFixed(1) + ' ' + (p[1] * k + oy).toFixed(1);
  const f = fillPolys.map(p => 'M' + p.map(T).join('L') + 'Z');
  const sOut = strokes.map(p => (p.length === 1 ? 'M' + T(p[0]) + 'h.1' : 'M' + p.map(T).join('L')));

  // colour of each region, sampled from the photo (crayon / paint), else null → palette
  const fc = fillPolys.map(poly => {
    if (!colour) return null;
    const cs = colour.width / w; let r = 0, g = 0, b = 0, n = 0, tot = 0;
    const pb = poly.reduce((a, p) => ({ x0: Math.min(a.x0, p[0]), y0: Math.min(a.y0, p[1]), x1: Math.max(a.x1, p[0]), y1: Math.max(a.y1, p[1]) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    for (let y = Math.floor(pb.y0); y <= pb.y1; y++) for (let x = Math.floor(pb.x0); x <= pb.x1; x++) {
      if (!pointInPoly(x + 0.5, y + 0.5, poly)) continue;
      const cx = Math.min(colour.width - 1, Math.floor((x + 0.5) * cs)), cy = Math.min(colour.height - 1, Math.floor((y + 0.5) * cs)), j = (cy * colour.width + cx) * 4;
      tot++;
      const d = colour.data, sat = saturation(d, j), lum = (d[j] + d[j + 1] + d[j + 2]) / 765;
      if (sat > 0.28 && lum > 0.18) { r += d[j]; g += d[j + 1]; b += d[j + 2]; n++; }
    }
    if (!tot || n / tot < 0.18) return null;
    // brighten a little: crayon photos come out dull
    r /= n; g /= n; b /= n; const mx = Math.max(r, g, b), boost = Math.min(1.5, 235 / Math.max(1, mx));
    return hex(r * boost, g * boost, b * boost);
  });
  const out: Vector = { f, s: sOut, fc };
  if (colour) Object.assign(out, cutout(mask, mw, mh, solid, w, h, colour, k, ox, oy));
  return out;
}

/**
 * The drawing as a cut-out: the silhouette of everything drawn (regions plus lines), and the real photo of it.
 * The 3D object is this silhouette given depth, with the drawing printed on it, so nothing is redrawn or changed.
 * It is traced on a finer grid than the regions and strokes, so thin lines and small details keep their exact shape.
 */
function cutout(mask: Uint8Array, mw: number, mh: number, solid: Uint8Array, w: number, h: number, colour: Img, k: number, ox: number, oy: number) {
  const hs = Math.min(1, 420 / Math.max(mw, mh)), W = Math.max(4, Math.round(mw * hs)), H = Math.max(4, Math.round(mh * hs));
  const cov = new Float32Array(W * H), cnt = new Float32Array(W * H);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const j = Math.min(H - 1, Math.floor(y * hs)) * W + Math.min(W - 1, Math.floor(x * hs)); cnt[j]++; if (mask[y * mw + x]) cov[j]++; }
  let S: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < S.length; i++) S[i] = cnt[i] && cov[i] / cnt[i] > 0.15 ? 1 : 0;
  S = dilate(S, W, H, 1);
  // enclosed regions (found on the coarser grid) are filled in, so a body is solid, not just its outline
  const fw = w / W, fh = h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid[Math.min(h - 1, Math.floor((y + 0.5) * fh)) * w + Math.min(w - 1, Math.floor((x + 0.5) * fw))]) S[y * W + x] = 1;
  S = despeckle(S, W, H, 8);
  const T = (p: Pt): string => (p[0] * fw * k + ox).toFixed(2) + ' ' + (p[1] * fh * k + oy).toFixed(2);
  const ring = (c: Pt[]) => { const q = capPoints(rdpClosed(chaikin(c, true, 1), 0.5), 420); return q.length >= 3 ? 'M' + q.map(T).join('L') + 'Z' : null; };
  const fg = label(S, W, H, true), outer: string[] = [];
  for (let id = 1; id < fg.sizes.length; id++) { const r = ring(traceContour(fg.lab, W, H, id)); if (r) outer.push(r); }
  const bgl = label(S.map(v => (v ? 0 : 1)) as Uint8Array, W, H, false), edge = new Set<number>(), holes: string[] = [];
  for (let x = 0; x < W; x++) { edge.add(bgl.lab[x]); edge.add(bgl.lab[(H - 1) * W + x]); }
  for (let y = 0; y < H; y++) { edge.add(bgl.lab[y * W]); edge.add(bgl.lab[y * W + W - 1]); }
  for (let id = 1; id < bgl.sizes.length; id++) { if (edge.has(id) || bgl.sizes[id] < 12) continue; const r = ring(traceContour(bgl.lab, W, H, id)); if (r) holes.push(r); }

  // the photo of the drawing over the silhouette's box, with the paper made clean white (crayon and ink keep their colours)
  const bb = bbox(S, W, H) || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  const bx0 = Math.max(0, bb.x0 - 1), by0 = Math.max(0, bb.y0 - 1), bx1 = Math.min(W - 1, bb.x1 + 1), by1 = Math.min(H - 1, bb.y1 + 1);
  const cs = colour.width / W, regW = (bx1 - bx0 + 1) * cs, regH = (by1 - by0 + 1) * cs, sc = Math.min(1, 1024 / Math.max(regW, regH));
  const AW = Math.max(8, Math.round(regW * sc)), AH = Math.max(8, Math.round(regH * sc)), art = new Uint8ClampedArray(AW * AH * 4);
  const white = [0, 1, 2].map(c => { const v: number[] = []; for (let j = c; j < colour.data.length; j += 4 * 7) v.push(colour.data[j]); v.sort((a, b) => a - b); return Math.max(60, v[Math.floor(v.length * 0.95)] || 255); });
  // the paper's own brightness at each spot, so a shadow across the sheet does not print grey
  const bg = background(toGray(colour), colour.width, colour.height), wl = (0.299 * white[0] + 0.587 * white[1] + 0.114 * white[2]) / 255;
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const cx = Math.min(colour.width - 1, Math.floor(bx0 * cs + ((x + 0.5) / AW) * regW)), cy = Math.min(colour.height - 1, Math.floor(by0 * cs + ((y + 0.5) / AH) * regH));
    const j = (cy * colour.width + cx) * 4, o = (y * AW + x) * 4, lift = clamp(wl / Math.max(0.2, bg[cy * colour.width + cx]), 1, 2);
    let r = (colour.data[j] * 255 * lift) / white[0], g = (colour.data[j + 1] * 255 * lift) / white[1], b = (colour.data[j + 2] * 255 * lift) / white[2];
    // near-white, unsaturated pixels are paper: make them clean white
    const l = (r + g + b) / 3, mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
    if (sat < 0.18 && l > 200) { const t = clamp((l - 200) / 30, 0, 1); r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
    art[o] = r; art[o + 1] = g; art[o + 2] = b; art[o + 3] = 255;
  }
  const artBox: [number, number, number, number] = [bx0 * fw * k + ox, by0 * fh * k + oy, (bx1 + 1) * fw * k + ox, (by1 + 1) * fh * k + oy];
  return { sil: { outer, holes }, art: { width: AW, height: AH, data: art } as Img, artBox };
}

// ---------- the whole thing ----------
export function processScan(photo: Img, opts: { minSharpness?: number } = {}): ScanResult {
  const src = resize(photo, 1600);
  const quad = detectPaper(src);
  const paper = quad ? warp(src, quad, 1000) : resize(src, 1000);
  const w = paper.width, h = paper.height;
  let m: Uint8Array = inkMask(paper);
  // only marks on the sheet: hands, their shadows and the background are not part of the drawing
  const area = drawingArea(paper);
  for (let i = 0; i < m.length; i++) if (!area[i]) m[i] = 0;
  m = despeckle(m, w, h, Math.max(6, Math.round(w * h * 0.00004)));
  // a photo of a room or a face is mostly "ink"; a drawing on paper is mostly paper
  if (m.reduce((a, v) => a + v, 0) > w * h * 0.55) return { ok: false, error: 'not-drawing', quad };
  m = onlyDrawing(m, w, h);
  const inkCount = m.reduce((a, v) => a + v, 0);
  if (inkCount < w * h * 0.0015) return { ok: false, error: 'empty', quad };
  const g = toGray(paper), sharp = sharpness(g, m, w, h);
  if (sharp < (opts.minSharpness ?? 0.045)) return { ok: false, error: 'blurry', quad, sharpness: sharp };
  const bb = bbox(m, w, h)!;
  const pad = Math.round(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.06) + 4;
  const x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad), x1 = Math.min(w - 1, bb.x1 + pad), y1 = Math.min(h - 1, bb.y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const crop = cropImg(paper, x0, y0, cw, ch);
  // the photo kept for the scrapbook (and shown to Claude) is the sheet only: a hand or the table at its edge becomes paper
  const pw = whiteLevel(paper);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (!area[(y0 + y) * w + x0 + x]) crop.data.set(pw, (y * cw + x) * 4);
  const cm = new Uint8Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) cm[y * cw + x] = m[(y0 + y) * w + x0 + x];
  const ink: Img = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
  for (let i = 0; i < cm.length; i++) if (cm[i]) { ink.data.set(crop.data.subarray(i * 4, i * 4 + 3), i * 4); ink.data[i * 4 + 3] = 255; }
  const vector = vectorise(cm, cw, ch, crop);
  if (!vector.f.length && !vector.s.length) return { ok: false, error: 'empty', quad };
  return { ok: true, quad, crop, ink, vector, sharpness: sharp };
}
