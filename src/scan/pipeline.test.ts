import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
class Path2DLike {
  pts: Pt[];
  constructor(d: string) { this.pts = d.replace(/[MZ]/g, '').split('L').map(p => p.trim().split(/\s+/).map(Number) as Pt); }
  contains(x: number, y: number) {
    let c = false; const p = this.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  }
}
// Real photos from families' scans (8-bit RGB or RGBA PNG), decoded with a tiny PNG reader.
function photoFile(name: string): Img {
  const buf = readFileSync(new URL('./fixtures/' + name, import.meta.url));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), idat: Buffer[] = [];
  for (let o = 8; o < buf.length;) { const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8); if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), bpp = buf[25] === 6 ? 4 : 3, stride = w * bpp, px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[o + x] = (line[x] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) data.set([px[i * bpp], px[i * bpp + 1], px[i * bpp + 2], 255], i * 4);
  return { width: w, height: h, data };
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
    expect(x1 - x0).toBeGreaterThan(40); expect(y1).toBeLessThanOrEqual(64); expect(y0).toBeGreaterThanOrEqual(0); // (sticker border included)
    // paper is white in the image, ink stays dark
    const d = v.art!.data; let light = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 240) light++; else if (l < 90) dark++; }
    expect(light).toBeGreaterThan(dark); expect(dark).toBeGreaterThan(20);
  });

  it('cuts along the drawing itself: the paper between the legs goes, a flower beside it is its own piece', () => {
    const img = canvas(640, 480, [92, 70, 55]);
    fillPoly(img, [[150, 60], [500, 80], [520, 430], [130, 410]], [246, 244, 238]);
    // a stick figure: head, body, arms, legs, and a flower beside it
    stroke(img, ellipse(300, 150, 25, 25), 2.5, [40, 40, 60]);
    stroke(img, [[300, 175], [300, 280]], 2.5, [40, 40, 60]);
    stroke(img, [[250, 210], [350, 210]], 2.5, [40, 40, 60]);
    stroke(img, [[300, 280], [270, 340]], 2.5, [40, 40, 60]); stroke(img, [[300, 280], [330, 340]], 2.5, [40, 40, 60]);
    stroke(img, [[390, 340], [390, 270]], 2.5, [40, 160, 60]); fillPoly(img, ellipse(390, 260, 14, 14), [230, 80, 120]);
    const v = processScan(img).vector!;
    expect(v.sil!.outer.length).toBe(2);
    expect(v.sil!.holes.length).toBe(0);
    // the figure's head is inside the cut-out; bare paper between the legs, and between the figure and the flower, is not
    const paths = v.sil!.outer.map(d => new Path2DLike(d)), inCut = (x: number, y: number) => paths.some(p => p.contains(x, y));
    // the drawing spans x 250…404, y 125…340 in the photo; its cut-out box adds a thin border all round
    const [x0, y0, x1, y1] = v.artBox!, b = 1.3, at = (x: number, y: number) => [x0 + b + ((x - 250) / 154) * (x1 - x0 - 2 * b), y0 + b + ((y - 125) / 215) * (y1 - y0 - 2 * b)] as const;
    expect(inCut(...at(300, 150))).toBe(true);
    expect(inCut(...at(300, 330))).toBe(false);
    expect(inCut(...at(365, 300))).toBe(false);
  });

  it('sees a small, light pencil drawing on a big sheet', () => {
    const img = canvas(1280, 960, [200, 196, 188]);
    fillPoly(img, [[340, 100], [940, 120], [930, 880], [330, 860]], [240, 238, 232]);
    stroke(img, ellipse(640, 480, 36, 24), 1.2, [120, 120, 125]); // about 6 cm across on an A4 sheet
    stroke(img, [[634, 504], [631, 522]], 1.2, [120, 120, 125]);
    expect(processScan(img)).toMatchObject({ ok: true });
  });

  // A real scan: a light pencil boat with a stick figure, held close in dim light, a sofa behind (a family's photo)
  it('scans a light pencil drawing from a real, soft, dim photo', () => {
    const img = photoFile('boat-pencil.png');
    const q = detectPaper(img)!;
    expect(q).not.toBeNull();
    expect(Math.min(q[0][1], q[1][1])).toBeLessThan(400); // the whole sheet, not just the part below the boat
    const r = processScan(img);
    expect(r).toMatchObject({ ok: true });
    expect(r.vector!.sil!.outer.length).toBe(1);
    expect(r.crop!.height).toBeGreaterThan(r.crop!.width * 0.7); // sail and hull together
  }, 30000);

  // More real photos from families. Each must scan with nothing of the drawing cut off (a sun or hearts beside it are pieces of their own).
  const share = (art: Img, test: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < art.data.length; i += 4) if (test(art.data[i], art.data[i + 1], art.data[i + 2])) n++; return n / (art.width * art.height); };
  const scanOf = (name: string) => { const img = photoFile(name), r = processScan(img); expect(r).toMatchObject({ ok: true }); expect(r.vector!.sil!.outer.length).toBeGreaterThanOrEqual(1); return { img, r }; };

  it('keeps the hearts around a felt-tip watermelon', () => {
    const { img, r } = scanOf('watermelon-marker.png');
    expect(r.crop!.height).toBeGreaterThan(img.height * 0.9); // the hearts at the top and the rind at the bottom
    expect(share(r.vector!.art!, (R, G, B) => R > 180 && G < 140 && B < 150)).toBeGreaterThan(0.08); // still red
  }, 30000);

  it('keeps a crayon house whole: the ground line is not the paper’s edge, and the sun in the corner stays', () => {
    const { img, r } = scanOf('house-crayon.png');
    expect(r.quad).toBeNull(); // the paper fills the photo
    expect(r.crop!.width).toBeGreaterThan(img.width * 0.95); // the tree on the left, the sun on the right
    expect(r.crop!.height).toBeGreaterThan(img.height * 0.95); // the sun at the top, the ground at the bottom
    const art = r.vector!.art!;
    expect(share(art, (R, G, B) => R > G + 40 && R > B + 40)).toBeGreaterThan(0.04); // red walls, not grey
    expect(share(art, (R, G, B) => B > R + 30 && B > G)).toBeGreaterThan(0.01); // the blue roof
    expect(share(art, (R, G, B) => G > R + 20 && G > B + 20)).toBeGreaterThan(0.01); // the green tree
  }, 30000);

  it('scans a pencil girl that fills the photo', () => {
    const { img, r } = scanOf('girl-pencil.png');
    expect(r.crop!.width).toBeGreaterThan(img.width * 0.85); expect(r.crop!.height).toBeGreaterThan(img.height * 0.9);
    expect(share(r.vector!.art!, (R, G, B) => Math.max(R, G, B) - Math.min(R, G, B) > 40)).toBeLessThan(0.01); // pencil stays grey
  }, 30000);

  it('keeps a crayon butterfly whole on lined paper: a leaf’s edge is not the paper’s edge', () => {
    const { img, r } = scanOf('butterfly-lined.png');
    expect(r.quad).toBeNull();
    expect(r.crop!.width).toBeGreaterThan(img.width * 0.9); expect(r.crop!.height).toBeGreaterThan(img.height * 0.9);
    expect(share(r.vector!.art!, (R, G, B) => G > R + 30 && G > B + 30)).toBeGreaterThan(0.06); // the green leaf
  }, 30000);

  it('finds a held book page under a child’s face, and keeps only the jellyfish (not the printed border or words)', () => {
    const { img, r } = scanOf('jellyfish-held.png');
    const q = r.quad!; expect(q).not.toBeNull();
    expect(Math.min(q[0][1], q[1][1])).toBeGreaterThan(img.height * 0.2); // below the face
    const sheetW = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    expect(r.crop!.width).toBeLessThan(sheetW * 0.85); // not the whole page
    expect(r.crop!.width).toBeGreaterThan(sheetW * 0.6); // the head and every tentacle
    expect(r.crop!.height).toBeGreaterThan(r.crop!.width * 0.75);
  }, 30000);

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
