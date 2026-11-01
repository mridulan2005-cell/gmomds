// Port of the prototype's <dadi-map3d> (map3d.js) to a plain class used by a React component.
// Changes from the prototype:
//  - drawings come from scans ({f, s, fc} paths) and are cached per drawing id, not per icon kind
//  - animation is driven by the recognised `motion` and `place`, not a fixed kind table
//  - strokes that sit inside a puffy region are drawn on both faces so they stay visible
//  - reduced-motion support, explicit dispose, a pick callback instead of a window global
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Motion, Spot } from '../lib/types';

export interface DrawCfg { id: string; f: string[]; s: string[]; fc?: (string | null)[]; fill: string; owner: 'd' | 'a'; motion: Motion; place: Spot }
export interface PlaceCfg { name: string; shape: string; color: string; theme: string; status: 'locked' | 'current' | 'done'; pairs: [DrawCfg, DrawCfg][] }
export interface MonthCfg { name: string; current: boolean; places: PlaceCfg[] }
export type MapConfig =
  | { mode: 'place'; key: string; place: PlaceCfg; fresh?: number; fade?: boolean }
  | { mode: 'month'; key: string; places: PlaceCfg[] }
  | { mode: 'stack'; key: string; months: MonthCfg[] };
export type Pick = { type: 'place'; pi: number } | { type: 'month'; mi: number };

const DADI = '#2F5FD0', CHILD = '#E4572E', INK = '#3d2b22', DEPTH = 6, BT = 2.4, STEP = 900;
const SLOTS = [[120, 110], [245, 100], [370, 110], [90, 205], [200, 212], [310, 205], [420, 200]];
const MPOS = [[-380, -250], [330, -180], [-330, 210], [380, 280]];
export const SHAPES: Record<string, string> = {
  A: 'M20 120 Q40 60 120 70 Q200 80 250 50 Q330 20 400 60 Q470 90 460 160 Q450 230 370 225 Q290 220 230 245 Q140 270 70 235 Q10 200 20 120 Z',
  B: 'M30 170 Q20 110 70 90 Q90 50 120 80 Q170 60 230 70 L250 30 L280 72 Q340 66 380 90 Q420 40 450 90 Q475 150 450 210 Q420 255 330 250 L120 255 Q40 250 30 170 Z',
  C: 'M40 140 Q30 60 130 50 Q240 35 340 45 Q450 55 445 140 Q440 235 330 240 Q220 250 120 238 Q45 225 40 140 Z',
  D: 'M30 200 Q30 120 90 100 L120 40 L160 95 Q260 80 350 90 Q450 100 450 180 Q450 250 300 248 Q150 252 80 245 Q30 240 30 200 Z',
};

function rnd(seed: number) { let s = (seed * 7919) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function hashSeed(str: string) { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000; return h; }
const easeBack = (k: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
function shade(hex: string, f = 0.78) { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f); return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
const now = () => performance.now() / 1000;
const parse = (d: string) => new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`).paths;

interface DrawGeo { fills: { geo: THREE.BufferGeometry; i: number }[]; a: THREE.BufferGeometry[]; b: THREE.BufferGeometry[] }
// Geometry is built once per drawing id and shared between map views (the store keeps the paths, not meshes).
const GEO_CACHE = new Map<string, DrawGeo>();
const ISLAND_CACHE = new Map<string, any>();

function tube(pts: THREE.Vector2[], z: number, closed: boolean, seed: number, rad: number): THREE.BufferGeometry {
  const R = rnd(seed); let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  if (pts.length < 2 || len < 1.5) { const g = new THREE.SphereGeometry(rad * 1.6, 8, 6); g.translate(pts[0].x, pts[0].y, z); return g; }
  const v = pts.map(p => new THREE.Vector3(p.x + (R() - 0.5) * 1.2, p.y + (R() - 0.5) * 1.2, z));
  if (closed && v.length > 2 && v[0].distanceTo(v[v.length - 1]) < 0.6) v.pop();
  if (v.length < 2) v.push(v[0].clone().add(new THREE.Vector3(0.5, 0, 0)));
  const curve = new THREE.CatmullRomCurve3(v, closed && v.length > 2, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.min(220, Math.max(10, Math.round(len * 1.3))), rad, 5, closed && v.length > 2);
}
function inPoly(p: THREE.Vector2, poly: THREE.Vector2[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }

export function drawingGeo(d: DrawCfg): DrawGeo {
  const hit = GEO_CACHE.get(d.id); if (hit) return hit;
  const out: DrawGeo = { fills: [], a: [], b: [] }, polys: THREE.Vector2[][] = [], base = hashSeed(d.id);
  d.f.forEach((path, di) => parse(path).forEach(p => {
    for (const sh of SVGLoader.createShapes(p)) {
      try { out.fills.push({ geo: new THREE.ExtrudeGeometry(sh, { depth: DEPTH, bevelEnabled: true, bevelThickness: BT, bevelSize: 1.2, bevelSegments: 3, curveSegments: 14 }), i: di }); } catch { /* skip a shape that cannot be triangulated */ }
    }
    p.subPaths.forEach((sp, i) => {
      const pts = sp.getPoints(); polys.push(pts);
      [-BT - 0.3, DEPTH + BT + 0.3].forEach((z, zi) => { out.a.push(tube(pts, z, true, base + di * 31 + i * 7 + zi + 1, 1.15)); out.b.push(tube(pts, z, true, base + di * 31 + i * 7 + zi + 57, 1.15)); });
    });
  }));
  d.s.forEach((path, di) => parse(path).forEach(p => p.subPaths.forEach((sp, i) => {
    const pts = sp.getPoints(); if (!pts.length) return;
    const mid = pts[Math.floor(pts.length / 2)];
    // details inside a puffy region (eyes, stripes) go on both faces, else they would be hidden inside it
    const zs = polys.some(poly => inPoly(mid, poly)) ? [-BT - 0.6, DEPTH + BT + 0.6] : [DEPTH / 2];
    zs.forEach((z, zi) => { out.a.push(tube(pts, z, false, base + di * 13 + i + 3 + zi * 5, 1.5)); out.b.push(tube(pts, z, false, base + di * 13 + i + 91 + zi * 5, 1.5)); });
  })));
  GEO_CACHE.set(d.id, out); return out;
}

interface Item { d: DrawCfg; base: THREE.Group; mover: THREE.Group; sc: THREE.Group; inner: THREE.Group; oa: THREE.Group; ob: THREE.Group; sh: THREE.Mesh; S: number; ph: number; rise: number }

export class MapScene {
  private el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(30, 1.6, 1, 30000);
  private controls: OrbitControls;
  private grad: THREE.DataTexture;
  private mats: Record<string, THREE.Material> = {};
  private owned: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [];
  private items: Item[] = [];
  private tweens: { m: THREE.Material[]; t0: number; dur: number }[] = [];
  private anims: { o: THREE.Object3D; i: number }[] = [];
  private qs: THREE.Sprite[] = [];
  private pickables: THREE.Object3D[] = [];
  private stackY = 0; private stackTarget = 0;
  private mode: string | null = null; private cfg: MapConfig | null = null; private lastKey = '';
  private raf = 0; private clock = new THREE.Clock(); private ro: ResizeObserver;
  private disc?: THREE.CircleGeometry; private dot?: THREE.SphereGeometry; private cone?: THREE.ConeGeometry; private box?: THREE.BoxGeometry; private slabGeo?: THREE.BoxGeometry;
  onPick: (p: Pick) => void = () => {};
  reducedMotion = false;

  constructor(el: HTMLElement) {
    this.el = el;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const touch = matchMedia('(pointer: coarse)').matches;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2)); // keep iPads smooth
    r.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    el.appendChild(r.domElement); this.renderer = r;
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xf1d9a8, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-400, 900, 700); this.scene.add(dl);
    const c = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.08; c.enablePan = false; c.minPolarAngle = 0.3; c.maxPolarAngle = 1.32; c.rotateSpeed = 0.6; this.controls = c;
    const gm = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat); gm.minFilter = gm.magFilter = THREE.NearestFilter; gm.needsUpdate = true; this.grad = gm;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    const cv = r.domElement; let down: { x: number; y: number; sy: number; moved: boolean } | null = null;
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, sy: this.stackTarget, moved: false }; });
    cv.addEventListener('pointermove', e => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 8) down.moved = true;
      if (this.mode === 'stack') { const k = this.el.clientHeight / (cv.getBoundingClientRect().height || 1); this.stackTarget = this.clampStack(down.sy + dy * k * 2.4); }
    });
    cv.addEventListener('pointerup', e => { if (down && !down.moved) this.pick(e); down = null; });
    cv.addEventListener('pointercancel', () => { down = null; });
    cv.addEventListener('wheel', e => { if (this.mode !== 'stack') return; e.preventDefault(); this.stackTarget = this.clampStack(this.stackTarget - e.deltaY * 1.4); }, { passive: false });
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose();
    this.clearOwned(); Object.values(this.mats).forEach(m => m.dispose()); this.grad.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }

  setConfig(cfg: MapConfig) {
    const key = JSON.stringify(cfg);
    if (key === this.lastKey) return;
    this.lastKey = key; this.build(cfg);
  }

  private clampStack(v: number) { const n = this.cfg && this.cfg.mode === 'stack' ? this.cfg.months.length : 1; return Math.min(0, Math.max(-(n - 1) * STEP, v)); }
  private resize() { const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.fitCamera(); }
  private toon(color: string, op = 1) { const k = 't' + color + op; return (this.mats[k] ||= new THREE.MeshToonMaterial({ color, gradientMap: this.grad, transparent: op < 1, opacity: op, depthWrite: op >= 1 })) as THREE.MeshToonMaterial; }
  private basic(color: string, op = 1) { const k = 'b' + color + op; return (this.mats[k] ||= new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, depthWrite: op >= 1 })) as THREE.MeshBasicMaterial; }
  private own<T extends THREE.Material | THREE.Texture | THREE.BufferGeometry>(x: T): T { this.owned.push(x); return x; }
  private clearOwned() { this.owned.forEach(x => x.dispose()); this.owned = []; }

  private drawing(d: DrawCfg, S: number, riseAt: number) {
    const g = drawingGeo(d), base = new THREE.Group(), mover = new THREE.Group(), sc = new THREE.Group(), inner = new THREE.Group();
    base.add(mover); mover.add(sc); sc.add(inner); inner.rotation.x = Math.PI; inner.position.set(-32, 60, DEPTH / 2);
    g.fills.forEach(({ geo, i }) => inner.add(new THREE.Mesh(geo, this.toon((d.fc && d.fc[i]) || d.fill || '#FFC93C'))));
    const lm = this.basic(d.owner === 'd' ? DADI : CHILD), oa = new THREE.Group(), ob = new THREE.Group();
    g.a.forEach(x => oa.add(new THREE.Mesh(x, lm))); g.b.forEach(x => ob.add(new THREE.Mesh(x, lm))); ob.visible = false; inner.add(oa, ob);
    sc.scale.setScalar(riseAt ? 0.0001 : S / 64);
    const sh = new THREE.Mesh(this.disc ||= new THREE.CircleGeometry(1, 24), this.basic(INK, 0.13)); sh.rotation.x = -Math.PI / 2; sh.scale.setScalar(S * 0.3); sh.position.y = 0.8; base.add(sh);
    this.items.push({ d, base, mover, sc, inner, oa, ob, sh, S, ph: (hashSeed(d.id) % 628) / 100, rise: riseAt });
    return base;
  }

  private islandGeo(shape: string) {
    const hit = ISLAND_CACHE.get(shape); if (hit) return hit;
    const sh = SVGLoader.createShapes(parse(SHAPES[shape] || SHAPES.A)[0])[0];
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 22, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 2, curveSegments: 24 }); geo.rotateX(Math.PI / 2); geo.translate(-240, 0, -140);
    const pts = sh.getPoints(60).map(p => new THREE.Vector3(p.x - 240, 3.4, p.y - 140));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const top = new THREE.TubeGeometry(curve, 200, 1.9, 5, true);
    const bot = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, -25.4, p.z)), true), 200, 1.6, 5, true);
    const sp = curve.getSpacedPoints(120), dashes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 120; i += 2) dashes.push(new THREE.TubeGeometry(new THREE.LineCurve3(sp[i], sp[i + 1]), 1, 2, 5, false));
    const out = { geo, top, bot, dashes }; ISLAND_CACHE.set(shape, out); return out;
  }

  private sprite(text: string, o: { size?: number; pill?: boolean; bg?: string; color?: string; k?: number } = {}) {
    const fs = o.size || 56, pad = o.pill ? fs * 0.7 : fs * 0.2, c = document.createElement('canvas'); let x = c.getContext('2d')!; const font = `800 ${fs}px Urbanist, Helvetica, sans-serif`; x.font = font;
    const tw = x.measureText(text).width; c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(fs * 1.7); x = c.getContext('2d')!; x.font = font;
    if (o.pill) { x.fillStyle = o.bg || '#FFF3D1'; x.beginPath(); if ((x as any).roundRect) (x as any).roundRect(0, 0, c.width, c.height, c.height / 2); else x.rect(0, 0, c.width, c.height); x.fill(); }
    x.fillStyle = o.color || INK; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, c.width / 2, c.height / 2 + fs * 0.06);
    const tex = this.own(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })));
    const k = o.k || 1; s.scale.set(c.width * k, c.height * k, 1); s.renderOrder = 10; return s;
  }
  private lockSprite(k = 1) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
    x.fillStyle = '#FFF3D1'; x.strokeStyle = INK; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 56, 0, 7); x.fill(); x.stroke();
    x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.moveTo(48, 60); x.lineTo(48, 48); x.arc(64, 48, 16, Math.PI, 0); x.lineTo(80, 60); x.stroke();
    x.fillStyle = '#F26A2E'; x.beginPath(); if ((x as any).roundRect) (x as any).roundRect(40, 58, 48, 36, 8); else x.rect(40, 58, 48, 36); x.fill(); x.stroke();
    const tex = this.own(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))); s.scale.set(90 * k, 90 * k, 1); return s;
  }

  private island(p: PlaceCfg, o: { fresh?: number; fade?: boolean; q?: boolean; S?: number; pick?: Pick | null; label?: string | null; lockK?: number }) {
    const G = new THREE.Group(), ig = this.islandGeo(p.shape), st = p.status, t0 = now();
    let top: THREE.Material, side: THREE.Material, line: THREE.Material | null = null;
    if (st === 'done') {
      if (o.fade) {
        top = this.own(new THREE.MeshToonMaterial({ color: p.color, gradientMap: this.grad, transparent: true, opacity: 0 }));
        side = this.own(new THREE.MeshToonMaterial({ color: shade(p.color), gradientMap: this.grad, transparent: true, opacity: 0 }));
        line = this.own(new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0 }));
        this.tweens.push({ m: [top, side, line], t0, dur: this.reducedMotion ? 0.6 : 2.6 });
      } else { top = this.toon(p.color); side = this.toon(shade(p.color)); line = this.basic(INK); }
    } else if (st === 'current') { top = this.toon('#ffffff', 0.42); side = this.toon('#ffffff', 0.2); }
    else { top = this.toon('#EEE7D8', 0.7); side = this.toon('#D8CFBC', 0.55); }
    const mesh = new THREE.Mesh(ig.geo, [top, side]); G.add(mesh);
    if (line) { G.add(new THREE.Mesh(ig.top, line)); G.add(new THREE.Mesh(ig.bot, line)); }
    if (st !== 'done' || o.fade) { const dm = this.basic(st === 'locked' ? '#B5AA94' : INK); ig.dashes.forEach((d: THREE.BufferGeometry) => G.add(new THREE.Mesh(d, dm))); }
    if (st === 'done') this.decor(p, G, !!o.fade);
    if (o.pick) { mesh.userData.pick = o.pick; this.pickables.push(mesh); }
    if (st !== 'locked') p.pairs.forEach((pr, j) => {
      const slot = SLOTS[j % SLOTS.length]; if (!slot) return; const [u, v] = slot;
      ([[pr[0], -32, 0], [pr[1], 32, 10]] as const).forEach(([d, du, dv], side) => {
        if (!d) return;
        const rise = o.fresh === j ? t0 + (side ? 1.2 : 0.35) : 0;
        const b = this.drawing(d, o.S || 72, rise); b.position.set(u - 240 + du, 3, v - 140 + dv); G.add(b);
      });
    });
    if (st === 'current' && o.q) { const q = this.sprite('?', { size: 150, color: '#8E7FD0' }); q.position.set(0, 150, 0); G.add(q); this.qs.push(q); }
    if (st === 'locked') { const l = this.lockSprite(o.lockK || 1.4); l.position.set(0, 70, 0); G.add(l); }
    if (o.label) { const s = this.sprite(o.label, { size: 46, pill: true, bg: st === 'done' ? INK : '#FFF3D1', color: st === 'done' ? '#FFF3D1' : INK, k: 1.25 }); s.position.set(0, 215, -80); G.add(s); }
    return G;
  }

  private decor(p: PlaceCfg, G: THREE.Group, fade: boolean) {
    const fadeIn = (m: THREE.Material) => { if (fade) { m.transparent = true; m.opacity = 0; this.tweens.push({ m: [m], t0: now(), dur: this.reducedMotion ? 0.6 : 2.6 }); } return m; };
    if (p.theme === 'river') {
      const m = fade ? fadeIn(this.own(new THREE.MeshBasicMaterial({ color: '#ffffff' }))) : this.basic('#ffffff');
      [-40, 10, 60].forEach((z, i) => { const pts: THREE.Vector3[] = []; for (let x = -150; x <= 150; x += 10) pts.push(new THREE.Vector3(x, 5, z + Math.sin(x / 16) * 6)); const w = new THREE.Mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 2.2, 5, false)), m); G.add(w); this.anims.push({ o: w, i }); });
    }
    if (p.theme === 'garden') { const m = this.toon('#4E9F3D'); [[-170, -30], [150, -60], [-60, 80], [190, 60], [20, -90], [-190, 50], [80, 90]].forEach(([x, z]) => { const c = new THREE.Mesh(this.cone ||= new THREE.ConeGeometry(6, 16, 6), m); c.position.set(x, 11, z); G.add(c); }); }
    if (p.theme === 'market') { ['#F26A2E', '#E9A3C0', '#8FD6D0', '#FFC93C', '#9BD770'].forEach((col, i) => { const c = new THREE.Mesh(this.box ||= new THREE.BoxGeometry(16, 12, 16), this.toon(col)); c.position.set(-180 + i * 90, 9, i % 2 ? -95 : 95); c.rotation.y = i * 0.5; G.add(c); }); }
    if (p.theme === 'rooftop') { const m = this.toon('#C8573E'); [[-185, -60], [185, -50], [-150, 90], [170, 80]].forEach(([x, z]) => { const c = new THREE.Mesh(this.box ||= new THREE.BoxGeometry(16, 12, 16), m); c.scale.set(0.8, 2, 0.8); c.position.set(x, 15, z); G.add(c); }); }
  }

  private month(places: PlaceCfg[], o: { pick?: boolean; labels?: boolean } = {}) {
    const G = new THREE.Group();
    places.forEach((p, i) => {
      const lbl = p.status === 'done' ? p.name : p.status === 'current' ? 'This week · ' + Math.max(0, 7 - p.pairs.length) + ' to go' : null;
      const g = this.island(p, { label: o.labels !== false ? lbl : null, q: true, pick: o.pick && p.status !== 'locked' ? { type: 'place', pi: i } : null, lockK: 1.6 });
      g.position.set(MPOS[i][0], 0, MPOS[i][1]); G.add(g);
    });
    const pts = [[-760, -420], ...MPOS, [760, 520]].map(([x, z]) => new THREE.Vector3(x, -10, z));
    const curve = new THREE.CatmullRomCurve3(pts), n = Math.round(curve.getLength() / 34), dm = this.toon('#FFC93C');
    curve.getSpacedPoints(n).forEach(pt => { const s = new THREE.Mesh(this.dot ||= new THREE.SphereGeometry(7, 10, 8), dm); s.position.copy(pt); G.add(s); });
    return G;
  }

  private board(m: MonthCfg, i: number) {
    const B = new THREE.Group(); B.userData.pick = { type: 'month', mi: i };
    const cream = this.toon('#FFF3D1', m.current ? 0.35 : 1), edge = this.toon('#E6CF92', m.current ? 0.3 : 1);
    const slab = new THREE.Mesh(this.slabGeo ||= new THREE.BoxGeometry(1700, 28, 1300), [edge, edge, cream, edge, edge, edge]); slab.position.y = -14; B.add(slab);
    const eg = this.own(new THREE.EdgesGeometry(this.slabGeo));
    if (m.current) { const e = new THREE.LineSegments(eg, this.own(new THREE.LineDashedMaterial({ color: INK, dashSize: 24, gapSize: 18 }))); e.computeLineDistances(); e.position.y = -14; B.add(e); }
    else { const e = new THREE.LineSegments(eg, this.own(new THREE.LineBasicMaterial({ color: INK }))); e.position.y = -14; B.add(e); }
    const mg = this.month(m.places, { labels: false }); mg.scale.setScalar(0.85); mg.position.y = 34; B.add(mg);
    if (m.current) mg.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const fix = (x: THREE.Material) => { const c = this.own(x.clone()); c.transparent = true; c.opacity = Math.min(x.opacity, 0.5); c.depthWrite = false; return c; }; mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material); } });
    const s = this.sprite(m.name, { size: 52, pill: true, bg: m.current ? '#FFF3D1' : INK, color: m.current ? INK : '#FFF3D1', k: 1.3 }); s.position.set(-990, 40, 0); B.add(s);
    this.pickables.push(B); return B;
  }

  private build(cfg: MapConfig) {
    this.cfg = cfg; this.root.clear(); this.clearOwned();
    this.items = []; this.tweens = []; this.anims = []; this.qs = []; this.pickables = [];
    if (cfg.mode === 'place') this.root.add(this.island(cfg.place, { fresh: cfg.fresh, fade: cfg.fade, q: true, S: 76 }));
    else if (cfg.mode === 'month') this.root.add(this.month(cfg.places, { pick: true }));
    else cfg.months.forEach((m, i) => { const b = this.board(m, i); b.position.y = -i * STEP; this.root.add(b); });
    this.frame(cfg.mode);
  }

  private frame(mode: string) {
    if (mode === this.mode) return; this.mode = mode; const c = this.controls, cam = this.camera;
    c.enabled = mode !== 'stack';
    if (mode === 'place') { c.target.set(0, 50, 10); cam.position.set(0, 520, 880); c.minDistance = 600; c.maxDistance = 1500; }
    if (mode === 'month') { c.target.set(0, 0, 20); cam.position.set(0, 1450, 1750); c.minDistance = 1200; c.maxDistance = 3200; }
    if (mode === 'stack') { this.stackY = this.stackTarget = 0; }
    this.fitCamera(); c.update();
  }

  /** Portrait screens are narrow: pull the camera back so the whole island / map still fits. */
  private fitCamera() {
    if (!this.mode || this.mode === 'stack') return;
    const a = this.camera.aspect, k = a < 1.25 ? Math.min(1.9, 1.25 / a) : 1, c = this.controls, cam = this.camera;
    const base = this.mode === 'place' ? new THREE.Vector3(0, 520, 880) : new THREE.Vector3(0, 1450, 1750);
    const dir = cam.position.clone().sub(c.target); const len = base.length() * k;
    if (dir.lengthSq() < 1) dir.copy(base);
    cam.position.copy(c.target).add(dir.setLength(len));
    if (this.mode === 'place') { c.minDistance = 600 * k; c.maxDistance = 1500 * k; } else { c.minDistance = 1200 * k; c.maxDistance = 3200 * k; }
  }

  private pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    for (const h of rc.intersectObjects(this.pickables, true)) { let o: THREE.Object3D | null = h.object; while (o && !o.userData.pick) o = o.parent; if (o) { this.onPick(o.userData.pick); return; } }
  }

  /** Bring a drawing to life according to what it is (motion) and where it lives (sky / ground / water). */
  private animate(it: Item, t: number) {
    const m = it.mover, p = t + it.ph, i = it.inner, A = this.reducedMotion ? 0.25 : 1, d = it.d;
    const H = d.place === 'sky' ? 110 : d.place === 'water' ? 4 : 0;
    m.position.set(0, H, 0); m.rotation.set(0, 0, 0); i.scale.set(1, 1, 1);
    switch (d.motion) {
      case 'fly': { const a = p * 0.55 * A, r = 55; m.position.set(Math.cos(a) * r, Math.max(H, 80) + Math.sin(p * 1.3) * 10 * A, Math.sin(a) * r * 0.6); m.rotation.y = Math.atan2(-Math.cos(a) * 0.6, -Math.sin(a)); i.scale.y = 1 - 0.22 * A * Math.abs(Math.sin(t * 6 + it.ph)); break; }
      case 'float': m.position.y = (H || 28) + Math.sin(p * 0.7) * 9 * A; m.rotation.z = Math.sin(p * 0.6) * 0.12 * A; m.rotation.y = Math.sin(p * 0.3) * 0.5 * A; break;
      case 'spin': m.position.y = H + (H ? Math.sin(p * 0.5) * 5 * A : 0); m.rotation.y = t * 0.4 * A; break;
      case 'swim': m.position.x = Math.sin(p * 0.7 * A) * 40; m.position.y = 6; m.rotation.y = Math.cos(p * 0.7 * A) > 0 ? 0 : Math.PI; m.rotation.z = Math.sin(p * 5) * 0.06 * A; break;
      case 'rock': m.rotation.z = Math.sin(p * 1.2) * 0.08 * A; m.position.x = Math.sin(p * 0.3) * 24 * A; break;
      case 'sway': m.rotation.z = Math.sin(p * 0.9) * 0.06 * A; m.rotation.y = Math.sin(p * 0.25) * 0.3 * A; break;
      case 'flicker': i.scale.y = 1 + Math.sin(p * 9) * 0.04 * A + Math.sin(p * 23) * 0.015 * A; m.rotation.y = Math.sin(p * 0.4) * 0.4 * A; break;
      case 'swing': m.rotation.z = Math.sin(p * 2.2) * 0.2 * A; break;
      case 'bounce': m.position.y = H + Math.abs(Math.sin(p * 2.6)) * 12 * A; i.scale.y = 1 - 0.06 * A * Math.max(0, Math.cos(p * 5.2)); break;
      case 'flow': m.position.x = Math.sin(p * 1.1) * 8 * A; i.scale.x = 1 + Math.sin(p * 2.2) * 0.03 * A; break;
      case 'walk': { const x = Math.sin(p * 0.35 * A) * 34; m.position.x = x; m.position.y = H + Math.abs(Math.sin(p * 5)) * 3 * A; m.rotation.y = Math.cos(p * 0.35 * A) >= 0 ? 0 : Math.PI; m.rotation.z = Math.sin(p * 5) * 0.04 * A; break; }
      case 'hop': m.position.y = H + Math.max(0, Math.sin(p * 3)) * 18 * A; m.position.x = Math.sin(p * 0.25) * 20 * A; m.rotation.y = Math.sin(p * 0.25) * 0.6 * A; break;
      case 'none': m.rotation.y = Math.sin(p * 0.4) * 0.15 * A; break;
      default: /* breathe */ i.scale.setScalar(1 + Math.sin(p * 2) * 0.03 * A); m.rotation.y = Math.sin(p * 0.35) * 0.35 * A;
    }
    it.sh.position.set(m.position.x, 0.8, m.position.z);
    const lift = Math.max(0, m.position.y); it.sh.scale.setScalar(it.S * 0.3 * Math.max(0.45, 1 - lift / 260));
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime(), n = now();
    if (this.mode === 'stack') { this.stackY += (this.stackTarget - this.stackY) * 0.12; const back = Math.max(1, 1.75 / this.camera.aspect); this.camera.position.set(0, this.stackY + 1500 * back, 2500 * back); this.camera.lookAt(0, this.stackY - 150, 0); }
    else this.controls.update();
    const boil = this.reducedMotion ? true : Math.floor(t / 0.22) % 2 === 0;
    for (const it of this.items) {
      it.oa.visible = boil; it.ob.visible = !boil; this.animate(it, t);
      if (it.rise) { const k = this.reducedMotion ? 1 : Math.min(1, Math.max(0, (n - it.rise) / 1.4)); it.sc.scale.setScalar(Math.max(0.0001, (it.S / 64) * easeBack(k))); it.mover.rotation.x = -(1 - k) * (1 - k) * Math.PI / 2; if (k >= 1) it.rise = 0; }
    }
    for (const tw of this.tweens) { const k = Math.min(1, (n - tw.t0) / tw.dur); tw.m.forEach(m => { m.opacity = k; if (k >= 1) { m.transparent = false; m.needsUpdate = true; } }); }
    this.tweens = this.tweens.filter(tw => n - tw.t0 < tw.dur);
    for (const a of this.anims) a.o.position.x = this.reducedMotion ? 0 : ((t * 16 + a.i * 20) % 40) - 20;
    for (const q of this.qs) { q.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.4); q.position.y = 150 + Math.sin(t * 1.2) * 6; }
    this.renderer.render(this.scene, this.camera);
  };
}
