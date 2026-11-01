import { describe, expect, it } from 'vitest';
import { detectPaper, detectSheet, processScan, type Img, type Pt } from './pipeline';

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

  it('keeps only the drawing: no edge shadow, no stray speck far away', () => {
    const img = canvas(500, 400, [240, 238, 232]);
    stroke(img, ellipse(250, 200, 80, 60), 3, [30, 30, 30]);
    stroke(img, [[0, 380], [500, 380]], 6, [120, 118, 112]); // a shadow along the bottom edge
    stroke(img, [[460, 40], [462, 42]], 3, [30, 30, 30]); // a smudge in a far corner
    const r = processScan(img);
    expect(r.ok).toBe(true);
    // the crop hugs the drawing, not the whole page
    expect(r.crop!.width).toBeLessThan(260); expect(r.crop!.height).toBeLessThan(200);
  });

  it('says "not-drawing" for a photo that is not a drawing on paper', () => {
    const img = canvas(400, 300, [0, 0, 0]);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) img.data.set([(x * 7) % 200, (y * 5) % 160, ((x + y) * 3) % 120], (y * 400 + x) * 4);
    expect(processScan(img)).toMatchObject({ ok: false });
  });

  // A real scan: hands holding the sheet, one finger touching the drawing, things on the table, warm light.
  function busyPhoto(skin: [number, number, number]) {
    const img = canvas(640, 480, [150, 120, 95]); // table
    fillPoly(img, [[20, 20], [110, 20], [110, 90], [20, 90]], [235, 235, 230]); // a white box on the table
    fillPoly(img, ellipse(600, 420, 40, 40), [40, 90, 200]); // a blue cup
    stroke(img, [[560, 30], [630, 60]], 6, [30, 30, 30]); // a pen
    fillPoly(img, [[150, 60], [500, 80], [520, 430], [130, 410]], [250, 238, 215]); // paper under warm light
    stroke(img, ellipse(320, 230, 90, 60), 2.5, [40, 40, 60]); // the bird
    stroke(img, [[300, 290], [290, 340]], 2.5, [40, 40, 60]);
    stroke(img, [[340, 290], [350, 340]], 2.5, [40, 40, 60]);
    // a hand over the bottom-left corner, reaching in from the edge of the view
    fillPoly(img, [[0, 480], [0, 380], [120, 340], [200, 380], [210, 420], [160, 480]], skin);
    stroke(img, [[150, 360], [230, 300]], 14, skin); // a finger
    // another hand holding the right edge, its finger touching the bird's body
    fillPoly(img, [[640, 200], [640, 300], [470, 280], [450, 250], [480, 220]], skin);
    stroke(img, [[480, 240], [422, 232]], 10, skin); // (a finger hiding part of a line hides it from the camera too)
    return img;
  }
  for (const [name, skin] of [['light', [226, 178, 150]], ['dark', [120, 75, 45]]] as [string, [number, number, number]][]) {
    it(`ignores ${name} hands and the table, keeps the drawing`, () => {
      const img = busyPhoto(skin);
      const q = detectPaper(img);
      expect(q).not.toBeNull();
      [[150, 60], [500, 80], [520, 430], [130, 410]].forEach((c, i) => expect(Math.hypot(q![i][0] - c[0], q![i][1] - c[1])).toBeLessThan(24)); // even the covered corner
      expect(detectSheet(img).hands).toBe(true);
      const r = processScan(img);
      expect(r.ok).toBe(true);
      // nothing of the hands: the crop holds the bird (about 190 × 130 on the sheet), not the hands reaching in
      const sx = r.crop!.width, sy = r.crop!.height;
      expect(sx).toBeLessThan(290); expect(sy).toBeLessThan(230);
      expect(r.vector!.f.length).toBe(1); // the bird's body
      // no skin colour in the drawing's ink
      const ink = r.ink!.data; let skinPx = 0, inkPx = 0;
      for (let i = 0; i < ink.length; i += 4) if (ink[i + 3]) { inkPx++; if (ink[i] > ink[i + 2] + 40) skinPx++; }
      expect(skinPx / inkPx).toBeLessThan(0.05);
    });
  }

  // Held up to the camera: a tilted sheet in front of a light wall, a hand at each side, a crayon drawing
  // that fills much of it (so the sheet is not one plain region), and a shirt below.
  it('finds a sheet held up in front of a light wall, crayon drawing and all', () => {
    const img = canvas(640, 480, [214, 208, 198]); // light wall
    fillPoly(img, [[120, 400], [520, 400], [560, 480], [80, 480]], [70, 110, 170]); // shirt
    const quad: Pt[] = [[175, 70], [470, 95], [450, 400], [150, 380]];
    fillPoly(img, quad, [250, 250, 247]);
    fillPoly(img, ellipse(250, 170, 55, 45), [240, 90, 60]); // a red crayon sun
    fillPoly(img, [[200, 330], [420, 340], [415, 375], [195, 362]], [80, 170, 70]); // green grass
    stroke(img, [[300, 200], [330, 140], [360, 200], [300, 200]], 3, [40, 40, 140]); // a house roof
    stroke(img, [[305, 200], [305, 300], [355, 300], [355, 200]], 3, [40, 40, 140]);
    fillPoly(img, [[0, 180], [0, 300], [190, 260], [200, 210]], [205, 150, 120]); // left hand
    fillPoly(img, [[640, 200], [640, 330], [445, 290], [440, 240]], [205, 150, 120]); // right hand
    const q = detectPaper(img);
    expect(q).not.toBeNull();
    quad.forEach((c, i) => expect(Math.hypot(q![i][0] - c[0], q![i][1] - c[1])).toBeLessThan(24));
    expect(processScan(img)).toMatchObject({ ok: true });
  });

  it('sees no hands when the sheet is clear', () => {
    expect(detectSheet(photo().img).hands).toBe(false);
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
