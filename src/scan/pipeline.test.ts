import { describe, expect, it } from 'vitest';
import { detectPaper, processScan, type Img, type Pt } from './pipeline';

// A tiny rasteriser for synthetic "photos".
function canvas(w: number, h: number, rgb: [number, number, number]): Img {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return { width: w, height: h, data: d };
}
function fillPoly(img: Img, poly: Pt[], rgb: [number, number, number]) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) img.data.set(rgb, (y * img.width + x) * 4);
  }
}
function stroke(img: Img, pts: Pt[], r: number, rgb: [number, number, number]) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L * 2) + 1;
    for (let k = 0; k <= n; k++) {
      const cx = ax + ((bx - ax) * k) / n, cy = ay + ((by - ay) * k) / n;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < img.width && y < img.height) img.data.set(rgb, (y * img.width + x) * 4);
    }
  }
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 60): Pt[] => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)] as Pt);

function photo() {
  const img = canvas(640, 480, [92, 70, 55]); // wooden table
  const quad: Pt[] = [[150, 60], [500, 80], [520, 430], [130, 410]]; // slightly skewed paper
  fillPoly(img, quad, [246, 244, 238]);
  // a child's bird: round body, two legs, a dot eye, a beak line
  stroke(img, ellipse(320, 230, 90, 60), 2.5, [40, 40, 60]);
  stroke(img, [[300, 290], [290, 340]], 2.5, [40, 40, 60]);
  stroke(img, [[340, 290], [350, 340]], 2.5, [40, 40, 60]);
  stroke(img, [[405, 220], [440, 228], [405, 236]], 2.5, [40, 40, 60]);
  stroke(img, [[370, 210], [371, 211]], 4, [40, 40, 60]);
  return { img, quad };
}

describe('scan pipeline', () => {
  it('finds the four corners of the paper', () => {
    const { img, quad } = photo();
    const q = detectPaper(img);
    expect(q).not.toBeNull();
    q!.forEach((p, i) => { expect(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1])).toBeLessThan(14); });
  });

  it('turns a drawing into a puffy body and pencil strokes', () => {
    const { img } = photo();
    const r = processScan(img);
    expect(r.ok).toBe(true);
    expect(r.vector!.f.length).toBe(1); // the enclosed body
    expect(r.vector!.s.length).toBeGreaterThanOrEqual(3); // legs, beak, eye
    // every coordinate is inside the 64 box
    const nums = (r.vector!.f.join(' ') + ' ' + r.vector!.s.join(' ')).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...nums)).toBeLessThanOrEqual(65);
  });

  it('keeps crayon colour for coloured-in regions', () => {
    const { img } = photo();
    fillPoly(img, ellipse(320, 230, 84, 54), [250, 190, 40]);
    stroke(img, ellipse(320, 230, 90, 60), 2.5, [40, 40, 60]);
    stroke(img, [[370, 210], [371, 211]], 4, [40, 40, 60]); // eye drawn on top of the crayon
    const r = processScan(img);
    expect(r.ok).toBe(true);
    expect(r.vector!.f.length).toBe(1);
    expect(r.vector!.s.some(p => p.endsWith('h.1') || p.split('L').length <= 3)).toBe(true); // the eye survives
    const c = r.vector!.fc[0]!;
    expect(c).toMatch(/^#/);
    const [R, G, B] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    expect(R).toBeGreaterThan(B + 60); expect(G).toBeGreaterThan(B + 30);
  });

  it('keeps the drawing itself: an exact cut-out and its image', () => {
    const { img } = photo();
    const v = processScan(img).vector!;
    expect(v.sil!.outer.length).toBeGreaterThanOrEqual(1); // body with legs, beak and eye in one piece (eye may be separate)
    expect(v.art!.width).toBeGreaterThan(50);
    const [x0, y0, x1, y1] = v.artBox!;
    expect(x1 - x0).toBeGreaterThan(40); expect(y1).toBeLessThanOrEqual(61); expect(y0).toBeGreaterThanOrEqual(0);
    // paper is white in the image, ink stays dark
    const d = v.art!.data; let light = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 240) light++; else if (l < 90) dark++; }
    expect(light).toBeGreaterThan(dark); expect(dark).toBeGreaterThan(20);
  });

  it('says "empty" for a blank page', () => {
    const img = canvas(640, 480, [92, 70, 55]);
    fillPoly(img, [[150, 60], [500, 80], [520, 430], [130, 410]], [246, 244, 238]);
    expect(processScan(img)).toMatchObject({ ok: false, error: 'empty' });
  });

  it('works when the paper fills the whole view', () => {
    const img = canvas(500, 400, [240, 238, 232]);
    stroke(img, ellipse(250, 200, 100, 80), 3, [30, 30, 30]);
    const r = processScan(img);
    expect(r.quad).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.vector!.f.length).toBe(1);
  });
});
