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
interface Classes { w: number; h: number; g: Float32Array; sat: Float32Array; gm: Float32Array; ex: Float32Array; ey: Float32Array; skin: Uint8Array; grey: Uint8Array }
/** Per pixel, once the light's colour is removed: brightness, colourfulness, edge strength, skin, and soft grey (shadows). */
function classify(img: Img): Classes {
  const { width: w, height: h, data } = img, wl = whiteLevel(img), n = w * h;
  const g0 = new Float32Array(n), u0 = new Float32Array(n), v0 = new Float32Array(n), sat = new Float32Array(n), skin = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = Math.min(255, (data[j] * 255) / wl[0]), gg = Math.min(255, (data[j + 1] * 255) / wl[1]), b = Math.min(255, (data[j + 2] * 255) / wl[2]);
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    g0[i] = (0.299 * r + 0.587 * gg + 0.114 * b) / 255; sat[i] = mx ? (mx - mn) / mx : 0; skin[i] = skinAt(r, gg, b) ? 1 : 0;
    u0[i] = (r - gg) / 255; v0[i] = (b - gg) / 255; // colour, apart from brightness
  }
  // edge strength: a change in brightness, or in colour (white paper on a pale pink wall)
  const g = boxBlur(g0, w, h, 1), u = boxBlur(u0, w, h, 1), v = boxBlur(v0, w, h, 1), gm = new Float32Array(n), ex = new Float32Array(n), ey = new Float32Array(n), grey = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    // the strongest of the three channels gives the edge its strength and direction
    let bx = g[i + 1] - g[i - 1], by = g[i + w] - g[i - w], bm = Math.hypot(bx, by);
    for (const ch of [u, v]) { const cx = 0.8 * (ch[i + 1] - ch[i - 1]), cy = 0.8 * (ch[i + w] - ch[i - w]), cm = Math.hypot(cx, cy); if (cm > bm) { bx = cx; by = cy; bm = cm; } }
    gm[i] = bm / 2; ex[i] = bx; ey[i] = by;
  }
  for (let i = 0; i < n; i++) grey[i] = !skin[i] && sat[i] < 0.25 && g[i] > 0.3 ? 1 : 0;
  return { w, h, g, sat, gm, ex, ey, skin, grey };
}

/**
 * Canny edges: thin lines along the strongest changes in brightness, kept where they connect to a strong edge,
 * so a faint but continuous edge (a white sheet in front of a white wall) still counts.
 */
function canny(c: Classes): Uint8Array {
  const { w, h, gm, ex, ey } = c, n = w * h, nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = gm[i]; if (m < 0.003) continue;
    const gx = ex[i], gy = ey[i], a = Math.abs(Math.atan2(gy, gx)) % Math.PI;
    // neighbours across the edge
    const [o1, o2] = a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? [1, -1] : a < (3 * Math.PI) / 8 ? (gx * gy > 0 ? [w + 1, -w - 1] : [w - 1, -w + 1]) : a < (5 * Math.PI) / 8 ? [w, -w] : gx * gy > 0 ? [w - 1, -w + 1] : [w + 1, -w - 1];
    if (m >= gm[i + o1] && m >= gm[i + o2]) nms[i] = m;
  }
  // thresholds follow the scene: a white sheet on a white wall is only a few levels lighter, and that is the edge there is
  const sorted = Float32Array.from(gm).sort(), hi = Math.min(0.045, Math.max(0.008, sorted[Math.floor(n * 0.85)])), lo = Math.max(0.004, hi * 0.3);
  const e = new Uint8Array(n), st: number[] = [];
  for (let i = 0; i < n; i++) if (nms[i] >= hi) { e[i] = 1; st.push(i); }
  while (st.length) {
    const i = st.pop()!, x = i % w;
    for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) {
      const j = i + d; if (j < 0 || j >= n || Math.abs((j % w) - x) > 1 || e[j] || nms[j] < lo) continue;
      e[j] = 1; st.push(j);
    }
  }
  return e;
}

interface Found { c: Classes; m: Uint8Array; q: Pt[] | null; score: number }

interface Line { r: number; t: number; v: number } // x cos t + y sin t = r

/** The strongest straight lines among the edges (Hough transform): candidate sides of the sheet. */
function houghLines(e: Uint8Array, w: number, h: number, k: number): Line[] {
  const T = 180, D = Math.ceil(Math.hypot(w, h)), R = 2 * D + 1, acc = new Float32Array(T * R);
  const cs = Float32Array.from({ length: T }, (_, t) => Math.cos((t * Math.PI) / T)), sn = Float32Array.from({ length: T }, (_, t) => Math.sin((t * Math.PI) / T));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (e[y * w + x]) for (let t = 0; t < T; t++) acc[t * R + Math.round(x * cs[t] + y * sn[t]) + D]++;
  const out: Line[] = [], minVotes = Math.min(w, h) * 0.12;
  for (let n = 0; n < k; n++) {
    let bi = 0; for (let i = 1; i < acc.length; i++) if (acc[i] > acc[bi]) bi = i;
    if (acc[bi] < minVotes) break;
    const t = Math.floor(bi / R), r = (bi % R) - D; out.push(refineLine(e, w, h, { r, t: (t * Math.PI) / T, v: acc[bi] }));
    // clear the neighbourhood (theta wraps round with rho flipped)
    for (let dt = -8; dt <= 8; dt++) for (let dr = -8; dr <= 8; dr++) {
      let tt = t + dt, rr = r + dr; if (tt < 0) { tt += T; rr = -rr; } else if (tt >= T) { tt -= T; rr = -rr; }
      const ri = rr + D; if (ri >= 0 && ri < R) acc[tt * R + ri] = 0;
    }
  }
  return out;
}
/** Fit a line exactly to the edge pixels near it (the Hough bins are a degree wide: a few pixels off at the ends). */
function refineLine(e: Uint8Array, w: number, h: number, l: Line): Line {
  const c = Math.cos(l.t), s = Math.sin(l.t);
  let n = 0, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (e[y * w + x] && Math.abs(x * c + y * s - l.r) < 2.5) { n++; mx += x; my += y; sxx += x * x; syy += y * y; sxy += x * y; }
  if (n < 10) return l;
  mx /= n; my /= n; const a = sxx / n - mx * mx, b = sxy / n - mx * my, d = syy / n - my * my;
  const t = 0.5 * Math.atan2(2 * b, a - d) + Math.PI / 2; // normal of the best-fit direction
  let nt = ((t % Math.PI) + Math.PI) % Math.PI; const dt = Math.abs(nt - l.t) % Math.PI;
  if (Math.min(dt, Math.PI - dt) > 0.1) nt = l.t; // keep the Hough line if the fit wanders off
  return { r: mx * Math.cos(nt) + my * Math.sin(nt), t: nt, v: l.v };
}
function meetLines(a: Line, b: Line): Pt | null {
  const c1 = Math.cos(a.t), s1 = Math.sin(a.t), c2 = Math.cos(b.t), s2 = Math.sin(b.t), d = c1 * s2 - s1 * c2;
  return Math.abs(d) < 1e-6 ? null : [(a.r * s2 - b.r * s1) / d, (b.r * c1 - a.r * c2) / d];
}

/**
 * Find the sheet the way a document scanner does: many candidates, each scored on what makes a sheet a sheet.
 * Candidates come from paper-coloured areas at several brightness levels, from smooth areas, from areas walled in
 * by edges, and from the strongest straight edges paired up as four sides (so a drawing on the sheet, or a face
 * in front of it, does not break it up). A sheet's sides are real edges, it fills its four-sided outline (hands over
 * it count), its corners are sensible, and it is a good size near the middle. A white wall, a shirt or a table
 * fails where the sheet passes. q is null when the sheet fills the view (its sides are the frame); m is still the sheet.
 */
function findSheet(img: Img, maxSide: number, log?: object[], flat = false): Found {
  const small = resize(img, maxSide), c = classify(small), { w, h, g, sat, gm, skin } = c, N = w * h;
  const at = (x: number, y: number) => Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)));
  const ce = canny(c), near = dilate(ce, w, h, 2);
  let best: Found = { c, m: new Uint8Array(N), q: null, score: 0 }, whole = best;

  // edge support of a side: the fraction of it (in view, not under a hand) that runs along a real edge
  const sides = (q: Pt[]) => {
    let pass = 0, seen = 0, total = 0, onFrame = 0, weakest = 1, lighter = 0;
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, steps = Math.max(6, Math.round(L / 2));
      let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; } // outward
      let sp = 0, ss = 0;
      for (let s = 1; s < steps; s++) {
        const px = a[0] + ((b[0] - a[0]) * s) / steps, py = a[1] + ((b[1] - a[1]) * s) / steps; total++;
        if (px < 3 || py < 3 || px > w - 4 || py > h - 4) { onFrame++; continue; }
        const ii = at(px - nx * 3, py - ny * 3), oo = at(px + nx * 3, py + ny * 3);
        if (skin[ii] || skin[oo]) continue;
        seen++; ss++; if (g[ii] > g[oo] - 0.03) lighter++;
        let e = 0; for (let t = -2; t <= 2; t++) e = Math.max(e, gm[at(px + nx * t, py + ny * t)]);
        const diff = Math.abs(g[ii] - g[oo]);
        if ((e > 0.035 && diff > 0.05) || (near[at(px, py)] && diff > 0.01)) { pass++; sp++; } // a clear edge, or a faint one Canny traced
      }
      if (ss >= steps * 0.3) weakest = Math.min(weakest, sp / ss);
    }
    return { pass, seen, total, onFrame, cx, cy, weakest, lighter: seen ? lighter / seen : 1 };
  };

  const consider = (q: Pt[], cm: Uint8Array, strict = false) => {
    const qa = polyArea(q); if (qa < N * 0.03) return;
    // sensible corners and sides: no slivers, no wild angles
    let okShape = true;
    for (let k = 0; k < 4; k++) {
      const a = q[(k + 3) % 4], b = q[k], d = q[(k + 1) % 4], v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = d[0] - b[0], v2y = d[1] - b[1];
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1))));
      if (ang < 0.6 || ang > 2.55) okShape = false;
    }
    const sl = q.map((p, k) => Math.hypot(q[(k + 1) % 4][0] - p[0], q[(k + 1) % 4][1] - p[1]));
    if (!okShape || Math.min(...sl) < Math.max(...sl) * 0.18) { log?.push({ q, why: 'shape' }); return; }
    // fills its outline: the region itself, marks it encloses (a drawing) and hands over it
    let x0 = w, y0 = h, x1 = 0, y1 = 0; for (const [x, y] of q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const cl = erode(dilate(cm, w, h, 6), w, h, 6);
    let inQ = 0, filled = 0, skinIn = 0, light = 0, lit = 0;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, x1); x++) {
      if (!pointInPoly(x + 0.5, y + 0.5, q)) continue; inQ++; const i = y * w + x;
      if (cm[i]) { filled++; light += g[i]; lit++; } else if (skin[i]) { filled++; skinIn++; } else if (cl[i]) filled += 0.7;
    }
    const fill = inQ ? filled / inQ : 0;
    if (fill < 0.6) { log?.push({ q, why: 'fill', fill }); return; }
    // hands hold a sheet at its edges; a "sheet" that is mostly hands or a face is not one
    if (skinIn > inQ * 0.3) { log?.push({ q, why: 'skin', fill }); return; }
    const { pass, seen, total, onFrame, cx, cy, weakest, lighter } = sides(q);
    // four straight lines can enclose any patch: each side must be an edge, with the sheet on its lighter side
    if (strict && (weakest < 0.45 || lighter < 0.7)) { log?.push({ q, why: 'edge', fill, edge: weakest }); return; }
    // the paper fills most of the view: its sides are the frame. If the sides that are in view are real edges
    // (a sheet held close, running off the left and right of the picture), it is a sheet like any other.
    const runsOff = onFrame > total * 0.55 && qa > N * 0.5, edgesSeen = seen >= total * 0.15 && pass / seen >= 0.6;
    const fillsView = runsOff && !edgesSeen;
    const edge = fillsView ? 0.8 : seen >= total * (runsOff ? 0.15 : 0.25) ? pass / seen : 0.4;
    if (!fillsView && edge < (strict ? 0.6 : 0.35)) { log?.push({ q, why: 'edge', fill, edge, seen, total }); return; }
    const centre = 1 - Math.min(0.8, Math.hypot(cx / w - 0.5, cy / h - 0.5) * 1.3);
    const white = Math.min(1, Math.max(0.2, ((lit ? light / lit : 0) - 0.25) / 0.55)); // drawing paper is white: of two cards, the whiter
    const score = edge ** 1.5 * fill ** 2 * Math.sqrt(Math.min(qa, N) / N) * centre * white;
    if (score < 0.02) { log?.push({ q, why: 'weak', fill, edge }); return; } // a faint patch at the edge of the view is no sheet
    log?.push({ q, fill, edge, centre, score, fillsView });
    if (fillsView) { if (score > whole.score) whole = { c, m: cm, q: null, score }; }
    else if (score > best.score) best = { c, m: cm, q, score };
  };

  // 1. regions: paper-coloured at several brightness levels, smooth, or walled in by edges
  const masks: [Uint8Array, boolean][] = []; // [mask, close over pencil lines]
  for (const L of [0.42, 0.52, 0.62, 0.72, 0.8, 0.88]) { const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = g[i] > L && sat[i] < 0.25 && !skin[i] ? 1 : 0; masks.push([m, true]); }
  for (const T of [0.022, 0.04]) { const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = gm[i] < T && g[i] > 0.3 && sat[i] < 0.3 && !skin[i] ? 1 : 0; masks.push([m, true]); }
  // (crayon on the sheet is part of it, so colour is allowed here; only the walls of edges split regions)
  for (const d of [1, 2]) { const de = dilate(ce, w, h, d), m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = !de[i] && g[i] > 0.25 && !skin[i] ? 1 : 0; masks.push([m, false]); }
  for (const [raw, close] of masks) {
    let m = close ? erode(dilate(raw, w, h, 2), w, h, 2) : raw; // over pencil lines
    m = dilate(erode(m, w, h, 1), w, h, 1); // off thin bits
    const { lab, sizes } = label(m, w, h, false);
    const ids = sizes.map((s, l) => [s, l]).filter(([s, l]) => l && s >= N * 0.02 && s <= N * 0.98).sort((a, b) => b[0] - a[0]).slice(0, 6).map(v => v[1]);
    for (const id of ids) {
      const cm = new Uint8Array(N); for (let i = 0; i < N; i++) if (lab[i] === id) cm[i] = 1;
      const hp = hull(outline(cm, w, h)); if (hp.length >= 4) consider(sidesQuad(hp), cm);
    }
  }

  // 2. straight edges paired up as four sides
  const lines = houghLines(ce, w, h, 14), quads: { q: Pt[]; sup: number }[] = [];
  const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
  const inReach = (p: Pt) => p[0] > -w * 0.3 && p[0] < w * 1.3 && p[1] > -h * 0.3 && p[1] < h * 1.3;
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) for (let cI = b + 1; cI < lines.length; cI++) for (let d = cI + 1; d < lines.length; d++) {
    const L = [lines[a], lines[b], lines[cI], lines[d]];
    for (const [p, q2, r, s] of [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]) {
      const A1 = L[p], A2 = L[q2], B1 = L[r], B2 = L[s];
      if (angDiff(A1.t, A2.t) > 0.45 || angDiff(B1.t, B2.t) > 0.45 || angDiff(A1.t, B1.t) < 0.6) continue;
      const corners = [meetLines(A1, B1), meetLines(B1, A2), meetLines(A2, B2), meetLines(B2, A1)];
      if (corners.some(pt => !pt || !inReach(pt))) continue;
      const qd = corners as Pt[];
      let sign = 0, convex = true;
      for (let k = 0; k < 4; k++) { const cr = cross(qd[k], qd[(k + 1) % 4], qd[(k + 2) % 4]); if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) convex = false; }
      if (!convex) continue;
      const qa = polyArea(qd); if (qa < N * 0.04 || qa > N * 1.3) continue;
      const sp = sides(qd); if (sp.seen < sp.total * 0.25) continue;
      quads.push({ q: qd, sup: sp.pass / sp.seen });
    }
  }
  quads.sort((x, y) => y.sup - x.sup);
  for (const { q } of quads.filter(o => o.sup >= 0.6).slice(0, 8)) {
    // the sheet inside these sides: what is light and not a hand, closed over pencil lines like the regions above
    let cm: Uint8Array = new Uint8Array(N);
    let x0 = w, y0 = h, x1 = 0, y1 = 0; for (const [x, y] of q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, x1); x++) {
      const i = y * w + x; if (g[i] > 0.3 && !skin[i] && pointInPoly(x + 0.5, y + 0.5, q)) cm[i] = 1;
    }
    cm = erode(dilate(cm, w, h, 2), w, h, 2);
    consider(q, cm, true);
  }

  // "the paper fills the view" only when no sheet with real edges was found (a light wall also fills the view),
  // or when the view is already the sheet, cut out and flattened (then a box drawn on it is not a smaller sheet)
  if (flat && whole.score) return whole;
  if (!best.score || (whole.score && best.score < whole.score * 0.15)) return whole.score ? whole : best;
  return best;
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
 * Find the sheet of paper (four corners) and whether hands are over it. Hands, a lap, a white wall or a busy table
 * are not the sheet, and a hand over a corner does not cut the corner off (the sheet's sides are extended to meet).
 * quad is null when no clear sheet is found, for example when the paper fills the whole view.
 */
export function detectSheet(img: Img): Sheet {
  const f = findSheet(img, 256), { c } = f, { w, h } = c, poly = f.q;
  let quad: Quad | null = null;
  if (poly) { const sx = img.width / w, sy = img.height / h; quad = orderQuad(poly.map(([x, y]) => [x * sx, y * sy] as Pt)); }
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

/** The Canny edges the sheet finder sees (for tools/paper-lab.html). */
export function sheetEdges(img: Img): { w: number; h: number; e: Uint8Array } { const c = classify(resize(img, 256)); return { w: c.w, h: c.h, e: canny(c) }; }

/** Every candidate sheet and why it won or lost, in the scaled-down image's coordinates (for tools/paper-lab.html). */
export function sheetCandidates(img: Img, maxSide = 256): { w: number; h: number; list: object[] } { const list: object[] = [], f = findSheet(img, maxSide, list); return { w: f.c.w, h: f.c.h, list }; }

/** Find the sheet of paper: four corners, or null when no clear sheet is found. */
export function detectPaper(img: Img): Quad | null { return detectSheet(img).quad; }

/**
 * Where a drawing can be: the sheet and the marks on it. Hands (skin, and the shadows they cast, reaching in
 * from the edge), the background, and anything else that reaches in from outside the sheet are left out.
 * Returns a mask the size of img. flat: img is the sheet already cut out and flattened.
 */
export function drawingArea(img: Img, flat = false): Uint8Array {
  const f = findSheet(img, 320, undefined, flat), { c } = f, { w, h } = c, W = img.width, H = img.height;
  const area = new Uint8Array(W * H);
  if (!f.score) { area.fill(1); return area; }
  const P = f.m, hp = hull(outline(P, w, h));
  const inHull = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inHull[y * w + x] = hp.length >= 3 && pointInPoly(x + 0.5, y + 0.5, hp) ? 1 : 0;
  const shadow = dilate(erode(c.grey, w, h, 2), w, h, 2); // thick soft grey, not thin pencil lines
  // on the flattened sheet, strong red and orange is crayon (a sun, a mouth), not a hand
  const skin = flat ? c.skin.map((v, i) => (v && c.sat[i] < 0.7 ? 1 : 0)) as Uint8Array : c.skin;
  // flood in from the edge of the view: anything outside the sheet, and over the sheet only hands and their shadows
  const out = new Uint8Array(w * h), pass = (i: number) => !P[i] && (!inHull[i] || skin[i] || shadow[i]), st: number[] = [];
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
  // on the flattened sheet a drawing may run up to the paper's edge (a head, a sun in the corner): only marks lying
  // along an edge (a strip of table, a sleeve) reach in from outside
  const along = new Float64Array(rl.sizes.length);
  if (flat) { for (let x = 0; x < w; x++) { along[rl.lab[x]]++; along[rl.lab[(h - 1) * w + x]]++; } for (let y = 0; y < h; y++) { along[rl.lab[y * w]]++; along[rl.lab[y * w + w - 1]]++; } }
  const fromOutside = (l: number) => edge.has(l) && (!flat || along[l] > Math.min(w, h) * 0.08);
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < ok.length; i++) { const l = rl.lab[i]; ok[i] = !gone[i] && (P[i] || (l && !fromOutside(l) && byPaper[l] >= byHand[l])) ? 1 : 0; }
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
  // dark ink, crayon: much darker than the brightest paper nearby
  const dk = new Float32Array(w * h); for (let i = 0; i < dk.length; i++) dk[i] = 1 - g[i] / Math.max(0.15, bg[i]);
  // light pencil in a soft, unevenly lit photo can be only ~10% darker than the paper right around it: compare each
  // spot with the average paper around it, and set the cut-off just above the paper's own grain in this photo
  const R = Math.max(4, Math.round(Math.max(w, h) / 45)), gs = boxBlur(g, w, h, 1), around = boxBlur(boxBlur(gs, w, h, R), w, h, R);
  const lc = new Float32Array(w * h); for (let i = 0; i < lc.length; i++) lc[i] = 1 - gs[i] / Math.max(0.1, around[i]);
  // a pencil line is darker than the paper a few pixels beside it; a soft shadow is not (it fades out slowly)
  const r2 = Math.max(3, Math.round(Math.max(w, h) / 220)), near = boxBlur(gs, w, h, r2 * 2), line = new Float32Array(w * h);
  for (let i = 0; i < line.length; i++) line[i] = 1 - gs[i] / Math.max(0.1, near[i]);
  const ls = Float32Array.from(lc.filter((_, i) => i % 5 === 0)).sort(), med = ls[Math.floor(ls.length / 2)] || 0;
  const mad = Float32Array.from(ls.map(v => Math.abs(v - med))).sort()[Math.floor(ls.length / 2)] || 0.01;
  const strong = Math.max(0.05, med + 8 * 1.4826 * mad), weak = Math.max(0.03, med + 4.5 * 1.4826 * mad), st: number[] = [];
  for (let i = 0, j = 0; i < m.length; i++, j += 4) {
    if (dk[i] > 0.28 || (lc[i] > strong && line[i] > strong * 0.5) || (saturation(data, j) > 0.3 && g[i] < p90 * 0.96)) { m[i] = 1; st.push(i); } // pencil/pen, or crayon colour
  }
  // follow a line from its darker parts into its fainter parts
  while (st.length) {
    const i = st.pop()!, x = i % w;
    for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) { const j = i + d; if (j < 0 || j >= m.length || m[j] || Math.abs((j % w) - x) > 1 || ((lc[j] <= weak || line[j] <= weak * 0.4) && dk[j] <= 0.18)) continue; m[j] = 1; st.push(j); }
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
  let sum = 0, n = 0, ink = 0, ni = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!m[i]) continue; ink += g[i]; ni++;
    if (m[i - 1] && m[i + 1] && m[i - w] && m[i + w]) continue;
    const gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w]; sum += Math.hypot(gx, gy); n++;
  }
  if (!n) return 0;
  // measured against how dark the lines are: light pencil has gentle edges even when it is in focus
  const paper = Float32Array.from(g.filter((_, i) => i % 9 === 0)).sort()[Math.floor(g.length / 18)] || 1;
  const contrast = Math.max(0.05, paper - ink / ni);
  return (sum / n) * Math.min(4, Math.max(1, 0.5 / contrast));
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
  // cut like a sticker: one outline around the whole drawing, and everything inside it stays (the paper between
  // a figure's arms, between two people, inside a house), with a thin white border and rounded corners
  const reach = Math.max(3, Math.round(Math.max(W, H) * 0.12)), border = Math.max(1, Math.round(Math.max(W, H) * 0.025));
  S = erode(dilate(S, W, H, reach), W, H, reach - border);
  { // one outline around all of it: parts far apart (a figure and a flower beside it), bays of paper between them
    const hp = hull(outline(S, W, H));
    if (hp.length >= 3) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pointInPoly(x + 0.5, y + 0.5, hp)) S[y * W + x] = 1;
  }
  // round off the square corners the grid leaves, like scissors would
  for (let it = 0; it < 2; it++) { const b = boxBlur(Float32Array.from(S), W, H, Math.max(2, border * 2)); for (let i = 0; i < S.length; i++) S[i] = b[i] > 0.5 ? 1 : 0; }
  const inside = label(S.map(v => (v ? 0 : 1)) as Uint8Array, W, H, false), open = touchesBorder(inside.lab, W, H);
  for (let i = 0; i < S.length; i++) if (!S[i] && !open.has(inside.lab[i])) S[i] = 1;
  // the sticker is a little bigger than the lines: fit it to the 64 box, standing on the same ground line
  const sb = bbox(S, W, H) || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 }, sw = (sb.x1 - sb.x0 + 1) * fw, sh = (sb.y1 - sb.y0 + 1) * fh;
  k = 58 / Math.max(sw, sh); ox = 32 - (sb.x0 * fw + sw / 2) * k; oy = 61 - (sb.y1 + 1) * fh * k;
  const T = (p: Pt): string => (p[0] * fw * k + ox).toFixed(2) + ' ' + (p[1] * fh * k + oy).toFixed(2);
  const ring = (c: Pt[]) => { const q = capPoints(rdpClosed(chaikin(c, true, 1), 0.5), 420); return q.length >= 3 ? 'M' + q.map(T).join('L') + 'Z' : null; };
  const fg = label(S, W, H, true), outer: string[] = [];
  for (let id = 1; id < fg.sizes.length; id++) { const r = ring(traceContour(fg.lab, W, H, id)); if (r) outer.push(r); }
  const holes: string[] = []; // (none: see above)

  // the photo of the drawing over the silhouette's box, with the paper made clean white (crayon and ink keep their colours)
  const bb = bbox(S, W, H) || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  const bx0 = Math.max(0, bb.x0 - 1), by0 = Math.max(0, bb.y0 - 1), bx1 = Math.min(W - 1, bb.x1 + 1), by1 = Math.min(H - 1, bb.y1 + 1);
  const cs = colour.width / W, regW = (bx1 - bx0 + 1) * cs, regH = (by1 - by0 + 1) * cs, sc = Math.min(1, 1024 / Math.max(regW, regH));
  const AW = Math.max(8, Math.round(regW * sc)), AH = Math.max(8, Math.round(regH * sc)), art = new Uint8ClampedArray(AW * AH * 4);
  const white = [0, 1, 2].map(c => { const v: number[] = []; for (let j = c; j < colour.data.length; j += 4 * 7) v.push(colour.data[j]); v.sort((a, b) => a - b); return Math.max(60, v[Math.floor(v.length * 0.95)] || 255); });
  // the paper's own brightness at each spot, so a shadow across the sheet does not print grey
  const bg = background(toGray(colour), colour.width, colour.height), wl = (0.299 * white[0] + 0.587 * white[1] + 0.114 * white[2]) / 255;
  const px = (x: number, y: number) => {
    const cx = Math.min(colour.width - 1, Math.floor(bx0 * cs + ((x + 0.5) / AW) * regW)), cy = Math.min(colour.height - 1, Math.floor(by0 * cs + ((y + 0.5) / AH) * regH));
    const j = (cy * colour.width + cx) * 4, lift = clamp(wl / Math.max(0.2, bg[cy * colour.width + cx]), 1, 2);
    return [(colour.data[j] * 255 * lift) / white[0], (colour.data[j + 1] * 255 * lift) / white[1], (colour.data[j + 2] * 255 * lift) / white[2]];
  };
  // each spot against the paper right around it: plain paper (whatever the light) becomes clean white, and light
  // pencil, which a soft photo makes pale grey, is deepened so the darkest lines read like a pencil drawing
  const P = new Float32Array(AW * AH * 3), L = new Float32Array(AW * AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) { const i = y * AW + x, v = px(x, y); P.set(v, i * 3); L[i] = Math.min(1, (v[0] + v[1] + v[2]) / 765); }
  const paperL = background(L, AW, AH), dark = new Float32Array(AW * AH);
  for (let i = 0; i < dark.length; i++) dark[i] = Math.max(0, 1 - L[i] / Math.max(0.2, paperL[i]));
  const ds = Float32Array.from(dark.filter((_, i) => i % 3 === 0)).sort(), grain = ds[Math.floor(ds.length * 0.5)] + 0.02, deepest = ds[Math.floor(ds.length * 0.995)] || 0.3;
  const deepen = clamp(0.65 / Math.max(0.05, deepest - grain), 1, 6);
  for (let i = 0; i < dark.length; i++) {
    const o = i * 4, r = P[i * 3], g = P[i * 3 + 1], b = P[i * 3 + 2], mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
    const v = 255 * (1 - clamp((dark[i] - grain) * deepen, 0, 0.75)); // pencil grey, or white paper
    if (sat < 0.25) { art[o] = art[o + 1] = art[o + 2] = v; }
    else { const t = clamp((sat - 0.25) / 0.2, 0, 1); art[o] = v + (Math.min(255, r) - v) * t; art[o + 1] = v + (Math.min(255, g) - v) * t; art[o + 2] = v + (Math.min(255, b) - v) * t; } // crayon keeps its colour
    art[o + 3] = 255;
  }
  const artBox: [number, number, number, number] = [bx0 * fw * k + ox, by0 * fh * k + oy, (bx1 + 1) * fw * k + ox, (by1 + 1) * fh * k + oy];
  return { sil: { outer, holes }, art: { width: AW, height: AH, data: art } as Img, artBox };
}

// ---------- the whole thing ----------
export function processScan(photo: Img, opts: { minSharpness?: number } = {}): ScanResult {
  const src = resize(photo, 1600), quad = detectPaper(src);
  const r = scanSheet(src, quad, opts);
  // the sheet found had no drawing on it: perhaps it was the wrong sheet (a busy table, a sleeve). Look at the whole view.
  if (quad && !r.ok && (r.error === 'empty' || r.error === 'not-drawing')) { const all = scanSheet(src, null, opts, true); if (all.ok) return all; }
  return r;
}

function scanSheet(src: Img, quad: Quad | null, opts: { minSharpness?: number }, whole = false): ScanResult {
  const paper = quad ? warp(src, quad, 1000) : resize(src, 1000);
  const w = paper.width, h = paper.height;
  let m: Uint8Array = inkMask(paper);
  // only marks on the sheet: hands, their shadows and the background are not part of the drawing
  const area = drawingArea(paper, !!quad);
  for (let i = 0; i < m.length; i++) if (!area[i]) m[i] = 0;
  m = despeckle(m, w, h, Math.max(6, Math.round(w * h * 0.00004)));
  // a photo of a room or a face is mostly "ink"; a drawing on paper is mostly paper
  if (m.reduce((a, v) => a + v, 0) > w * h * 0.55) return { ok: false, error: 'not-drawing', quad };
  m = onlyDrawing(m, w, h);
  const inkCount = m.reduce((a, v) => a + v, 0);
  if (inkCount < w * h * 0.0004) return { ok: false, error: 'empty', quad }; // (a small pencil drawing can be under 0.1% of the sheet)
  const g = toGray(paper), sharp = sharpness(g, m, w, h);
  if (sharp < (opts.minSharpness ?? 0.045)) return { ok: false, error: 'blurry', quad, sharpness: sharp };
  const bb = bbox(m, w, h)!;
  // a thin line along the border of a blank sheet (its edge, a fold, notebook holes) is not a drawing
  const thin = Math.min((bb.x1 - bb.x0) / w, (bb.y1 - bb.y0) / h) < 0.04, rim = Math.min(bb.x0, bb.y0, w - 1 - bb.x1, h - 1 - bb.y1) < Math.min(w, h) * 0.12;
  if (thin && (rim || whole)) return { ok: false, error: 'empty', quad }; // (in the whole view: a sheet's edge)
  const pad = Math.round(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.1) + 4; // room for the sticker border
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
