// Port of the prototype's <dadi-map3d> (map3d.js) to a plain class used by a React component.
// Changes from the prototype:
//  - drawings come from scans ({f, s, fc} paths) and are cached per drawing id, not per icon kind
//  - animation is driven by the recognised `motion` and `place`, not a fixed kind table
//  - strokes that sit inside a puffy region are drawn on both faces so they stay visible
//  - reduced-motion support, explicit dispose, a pick callback instead of a window global
//  - tap Dadi or the grandchild (or setPov) to walk around through their eyes: joystick / WASD to walk, drag to look
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Motion, Spot } from '../lib/types';
import { PAIRS } from '../lib/content';

export interface DrawCfg {
  id: string; f: string[]; s: string[]; fc?: (string | null)[]; fill: string; owner: 'd' | 'a'; motion: Motion; place: Spot;
  /** exact cut-out of the drawing + where its image sits; when present the drawing is shown exactly as drawn */
  sil?: { outer: string[]; holes: string[] }; artBox?: [number, number, number, number]; art?: boolean;
  /** what it is ("cat", "a ginger cat"), for what they say when it is tapped */
  kind?: string; label?: string;
}
export interface PlaceCfg { name: string; shape: string; color: string; theme: string; status: 'locked' | 'current' | 'done'; pairs: [DrawCfg, DrawCfg][] }
export interface MonthCfg { name: string; current: boolean; places: PlaceCfg[] }
/** the caricatures they drew of each other (image URLs): d = Dadi, a = the grandchild */
export interface Walkers { d: string; a: string }
export type MapConfig = (
  | { mode: 'place'; key: string; place: PlaceCfg; fresh?: number; fade?: boolean }
  | { mode: 'month'; key: string; places: PlaceCfg[]; kind?: string }
  | { mode: 'stack'; key: string; months: MonthCfg[] }
) & { walkers?: Walkers; names?: { d: string; a: string } };
export type Pick = { type: 'place'; pi: number } | { type: 'month'; mi: number };
/** whose eyes the map is seen through: d = Dadi, a = the grandchild, null = the usual view from above */
export type Pov = 'd' | 'a' | null;

const DADI = '#2F5FD0', CHILD = '#E4572E', INK = '#3d2b22', DEPTH = 6, BT = 2.4, STEP = 900;
const SLOTS = [[120, 110], [245, 100], [370, 110], [90, 205], [200, 212], [310, 205], [420, 200]];
// a place now finishes with four pairs: spread them over the island (older places with seven keep SLOTS)
const SLOTS4 = [[130, 105], [345, 100], [150, 205], [360, 200]];
const MPOS = [[-380, -250], [330, -180], [-330, 210], [380, 280]];
// A finished map comes alive: its four islands sit on one piece of land with a river, a pond, hills, trees and sheep.
const LAND = [[-700, -380], [-560, -480], [-250, -440], [-120, -510], [120, -450], [300, -480], [520, -430], [720, -300], [700, -80], [780, 60], [720, 200], [760, 420], [570, 560], [300, 530], [100, 580], [-120, 500], [-360, 540], [-610, 480], [-740, 300], [-680, 120], [-780, -60], [-710, -200]];
const RIV = [[-30, -620], [10, -330], [-40, -60], [30, 180], [-20, 420], [10, 660]];
const MTN = [[655, -200, 80, 150], [-655, -10, 64, 120], [580, -370, 58, 105]];
const POND = [575, 60, 52];
function onLand(x: number, z: number) { let c = false; for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) { const [xi, zi] = LAND[i], [xj, zj] = LAND[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** height of the land (with its hills) at a spot */
function terrain(x: number, z: number) { let y = -26; for (const [mx, mz, r, hh] of MTN) { const d = Math.hypot(x - mx, z - mz); if (d < r) y = Math.max(y, -26 + hh * (1 - d / r)); } return y; }
const inRing = (poly: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
/** what they say when you tap something while walking around */
const SAY: Record<string, string> = { cat: 'Meow!', bird: 'Tweet tweet!', fish: 'Splash!', mango: 'Yum, a mango!', flower: 'Mmm, smells lovely!', tree: 'What a big tree!', sun: 'So warm!', moon: 'Hello, moon!', diya: 'So bright!', kite: 'Up it goes!', bell: 'Ding ding!', drum: 'Dum dum!', note: 'La la la!', boat: 'Ahoy!', waves: 'Whoosh!', chai: 'Mmm, chai!' };
function riverX(z: number) { for (let i = 1; i < RIV.length; i++) if (z <= RIV[i][1]) { const [x0, z0] = RIV[i - 1], [x1, z1] = RIV[i]; return x0 + ((x1 - x0) * (z - z0)) / (z1 - z0); } return RIV[RIV.length - 1][0]; }
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
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
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

// ---- the drawing exactly as drawn: its own outline given depth, its own image printed on front and back ----
const CUT_CACHE = new Map<string, THREE.ExtrudeGeometry | null>();
const ART_MATS = new Map<string, THREE.MeshBasicMaterial>();
const ringPts = (d: string) => { const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number), out: THREE.Vector2[] = []; for (let i = 0; i + 1 < n.length; i += 2) out.push(new THREE.Vector2(n[i], n[i + 1])); return out; };

export function cutoutGeo(d: DrawCfg): THREE.ExtrudeGeometry | null {
  if (CUT_CACHE.has(d.id)) return CUT_CACHE.get(d.id)!;
  let geo: THREE.ExtrudeGeometry | null = null;
  if (d.sil && d.artBox && d.sil.outer.length) {
    const shapes = d.sil.outer.map(o => new THREE.Shape(ringPts(o)));
    for (const h of d.sil.holes) {
      const pts = ringPts(h); if (pts.length < 3) continue;
      const owner = shapes.find(sh => inPoly(pts[0], sh.getPoints()));
      if (owner) owner.holes.push(new THREE.Path(pts));
    }
    try {
      geo = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 0.7, bevelSegments: 3, curveSegments: 1 });
      // map the drawing's image onto the shape: the caps show exactly what was drawn
      const [x0, y0, x1, y1] = d.artBox, pos = geo.attributes.position, uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / (x1 - x0), 1 - (pos.getY(i) - y0) / (y1 - y0));
      uv.needsUpdate = true;
    } catch { geo = null; }
  }
  CUT_CACHE.set(d.id, geo); return geo;
}

function artMaterial(d: DrawCfg, loader?: (id: string) => Promise<string | null>) {
  let m = ART_MATS.get(d.id);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color: '#FFFBF0' }); ART_MATS.set(d.id, m);
  const mat = m;
  loader?.(d.id).then(url => {
    if (!url) return;
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      mat.map = tex; mat.color.set('#ffffff'); mat.needsUpdate = true;
    });
  });
  return m;
}

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

type Stop = { x: number; z: number; y?: number; p?: number; act?: 'sniff' | 'look' | 'wave' | null; f?: 1 | -1 };
/** ground height where they may stand (in the walker's group), or null where they can't */
type Ground = (x: number, z: number) => number | null;
interface Walker {
  s: THREE.Sprite; G: THREE.Group; who: 'd' | 'a'; legs: { a: Stop; b: Stop; t0: number; pause: number; dur: number }[]; total: number; h: number; off: number; face: number; hop: boolean; y0: number;
  ground: Ground; speed: number; waveUntil: number; parked: { x: number; z: number; y: number } | null;
}
interface Item { d: DrawCfg; base: THREE.Group; mover: THREE.Group; sc: THREE.Group; inner: THREE.Group; oa: THREE.Group; ob: THREE.Group; sh: THREE.Mesh; S: number; ph: number; rise: number; pop: number }
interface PovState { w: Walker; x: number; z: number; gy: number; yaw: number; pitch: number; t0: number; sp: THREE.Vector3; sq: THREE.Quaternion; sf: number; walkT: number }

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
  private flows: { o: THREE.Object3D; i: number; n: number; curve: THREE.CatmullRomCurve3 }[] = [];
  private sway: { o: THREE.Object3D; ph: number }[] = [];
  private sheep: { o: THREE.Object3D; cx: number; cz: number; ph: number }[] = [];
  private clouds: { o: THREE.Object3D; x0: number; v: number }[] = [];
  private ripples: { o: THREE.Object3D; m: THREE.MeshBasicMaterial; ph: number; R: number }[] = [];
  private walkers: Walker[] = [];
  private plants: THREE.Mesh[] = [];
  private huds: THREE.Object3D[] = [];
  private bubbles: { s: THREE.Sprite; t0: number; y0: number; dead?: boolean }[] = [];
  private pov: PovState | null = null;
  private joy = { x: 0, y: 0 }; private keys = new Set<string>(); private joyEl: HTMLDivElement; private lt = 0;
  private eye = new THREE.Vector3(); private look = new THREE.Vector3(); private dc = new THREE.PerspectiveCamera();
  private faceTex = new Map<string, THREE.Texture>();
  private landGeo?: Record<string, any>;
  private tv = new THREE.Vector3();
  private pickables: THREE.Object3D[] = [];
  private stackY = 0; private stackTarget = 0;
  private mode: string | null = null; private cfg: MapConfig | null = null; private lastKey = '';
  private raf = 0; private clock = new THREE.Clock(); private ro: ResizeObserver;
  private disc?: THREE.CircleGeometry; private dot?: THREE.SphereGeometry; private cone?: THREE.ConeGeometry; private box?: THREE.BoxGeometry; private slabGeo?: THREE.BoxGeometry;
  onPick: (p: Pick) => void = () => {};
  /** someone was tapped on the map (or the view went back to normal) */
  onPov: (who: Pov) => void = () => {};
  /** where to find each drawing's own image (an object URL from IndexedDB) */
  artLoader?: (id: string) => Promise<string | null>;
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
    c.enableDamping = true; c.dampingFactor = 0.08; c.minPolarAngle = 0.3; c.maxPolarAngle = 1.32; c.rotateSpeed = 0.6;
    // one finger (or the left mouse button) drags the map around (below); two fingers (or the right button) turn and zoom
    c.enablePan = false;
    c.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls = c;
    const gm = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat); gm.minFilter = gm.magFilter = THREE.NearestFilter; gm.needsUpdate = true; this.grad = gm;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    const cv = r.domElement, fingers = new Set<number>();
    let down: { x: number; y: number; lx: number; ly: number; sy: number; moved: boolean; ground: THREE.Vector3 | null } | null = null;
    cv.addEventListener('pointerdown', e => {
      fingers.add(e.pointerId);
      // a second finger turns and zooms instead; a tap still picks
      down = fingers.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, sy: this.stackTarget, moved: false, ground: this.pov ? null : this.groundAt(e) } : null;
      if (this.pov && down) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!down || fingers.size !== 1) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 8) down.moved = true;
      // through someone's eyes, dragging looks around
      if (this.pov) { const P = this.pov; P.yaw -= (e.clientX - down.lx) * 0.006; P.pitch = clamp(P.pitch - (e.clientY - down.ly) * 0.005, -0.85, 0.85); down.lx = e.clientX; down.ly = e.clientY; return; }
      if (this.mode === 'stack') { const k = this.el.clientHeight / (cv.getBoundingClientRect().height || 1); this.stackTarget = this.clampStack(down.sy + dy * k * 2.4); return; }
      // the spot of ground under the finger stays under the finger
      const g = this.groundAt(e); if (!down.ground || !g || !down.moved) return;
      const shift = down.ground.clone().sub(g); shift.y = 0;
      this.controls.target.add(shift); this.camera.position.add(shift); this.keepInView();
    });
    const up = (e: PointerEvent) => { fingers.delete(e.pointerId); if (e.type === 'pointerup' && down && !down.moved) { if (this.pov) this.povPick(e); else this.pick(e); } down = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { if (this.mode !== 'stack') return; e.preventDefault(); this.stackTarget = this.clampStack(this.stackTarget - e.deltaY * 1.4); }, { passive: false });
    // the joystick for walking around through someone's eyes
    const J = document.createElement('div'); J.className = 'joystick';
    J.innerHTML = '<svg viewBox="0 0 190 190" fill="none" stroke="#E0A25E" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M83 26 L95 14 L107 26"/><path d="M83 164 L95 176 L107 164"/><path d="M26 83 L14 95 L26 107"/><path d="M164 83 L176 95 L164 107"/></svg>';
    const K = document.createElement('div'); K.className = 'knob'; J.appendChild(K); el.appendChild(J); this.joyEl = J;
    const jmove = (e: PointerEvent) => {
      const r = J.getBoundingClientRect(), R = r.width * 0.34; let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.joy = { x: dx / R, y: -dy / R }; const k = J.offsetWidth / r.width; K.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    };
    let jid: number | null = null;
    J.addEventListener('pointerdown', e => { e.stopPropagation(); jid = e.pointerId; J.setPointerCapture(e.pointerId); jmove(e); });
    J.addEventListener('pointermove', e => { if (e.pointerId === jid) jmove(e); });
    const jend = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = null; this.joy = { x: 0, y: 0 }; K.style.transform = ''; };
    J.addEventListener('pointerup', jend); J.addEventListener('pointercancel', jend);
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
    this.loop();
  }

  /** WASD / arrow keys walk, Q / E turn */
  private onKey = (e: KeyboardEvent) => {
    if (!this.pov) return; const k = e.key.toLowerCase();
    if (e.type === 'keydown') { this.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); } else this.keys.delete(k);
  };

  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose();
    removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); this.joyEl.remove();
    this.clearOwned(); Object.values(this.mats).forEach(m => m.dispose()); this.grad.dispose(); this.faceTex.forEach(t => t.dispose());
    if (this.landGeo) Object.values(this.landGeo).flat().forEach((g: any) => g?.dispose?.());
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
    const g = d.art && d.sil ? { fills: [], a: [], b: [] } as DrawGeo : drawingGeo(d), base = new THREE.Group(), mover = new THREE.Group(), sc = new THREE.Group(), inner = new THREE.Group();
    base.add(mover); mover.add(sc); sc.add(inner); inner.rotation.x = Math.PI; inner.position.set(-32, 60, DEPTH / 2);
    const cut = d.art ? cutoutGeo(d) : null;
    if (cut) {
      // exactly as drawn: front and back show the drawing, the edge is a soft paper-coloured rim
      const rim = this.toon(shade((d.fc && d.fc.find(Boolean)) || '#F3EAD6', 0.9));
      inner.add(new THREE.Mesh(cut, [artMaterial(d, this.artLoader), rim]));
    } else g.fills.forEach(({ geo, i }) => inner.add(new THREE.Mesh(geo, this.toon((d.fc && d.fc[i]) || d.fill || '#FFC93C'))));
    const lm = this.basic(d.owner === 'd' ? DADI : CHILD), oa = new THREE.Group(), ob = new THREE.Group();
    if (!cut) { g.a.forEach(x => oa.add(new THREE.Mesh(x, lm))); g.b.forEach(x => ob.add(new THREE.Mesh(x, lm))); } ob.visible = false; inner.add(oa, ob);
    sc.scale.setScalar(riseAt ? 0.0001 : S / 64);
    const sh = new THREE.Mesh(this.disc ||= new THREE.CircleGeometry(1, 24), this.basic(INK, 0.13)); sh.rotation.x = -Math.PI / 2; sh.scale.setScalar(S * 0.3); sh.position.y = 0.8; base.add(sh);
    const it: Item = { d, base, mover, sc, inner, oa, ob, sh, S, ph: (hashSeed(d.id) % 628) / 100, rise: riseAt, pop: 0 };
    base.userData.item = it; this.items.push(it);
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
    const poly = sh.getPoints(60).map(p => [p.x - 240, p.y - 140]);
    const out = { geo, top, bot, dashes, poly }; ISLAND_CACHE.set(shape, out); return out;
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

  private island(p: PlaceCfg, o: { fresh?: number; fade?: boolean; q?: boolean; S?: number; pick?: Pick | null; label?: string | null; lockK?: number; walk?: boolean; walkH?: number }) {
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
    // they walk on the place in progress too; its theme stays a secret, so they just stroll there
    if (st !== 'locked' && o.walk) this.islandWalkers(st === 'done' ? p.theme : '', G, o.walkH || 100, ig.poly);
    if (o.pick) { mesh.userData.pick = o.pick; this.pickables.push(mesh); }
    const slots = p.pairs.length <= SLOTS4.length ? SLOTS4 : SLOTS;
    if (st !== 'locked') p.pairs.forEach((pr, j) => {
      const slot = slots[j % slots.length]; if (!slot) return; const [u, v] = slot;
      ([[pr[0], -32, 0], [pr[1], 32, 10]] as const).forEach(([d, du, dv], side) => {
        if (!d) return;
        const rise = o.fresh === j ? t0 + (side ? 1.2 : 0.35) : 0;
        const b = this.drawing(d, o.S || 72, rise); b.position.set(u - 240 + du, 3, v - 140 + dv); G.add(b);
      });
    });
    if (st === 'current' && o.q) { const q = this.sprite('?', { size: 150, color: '#8E7FD0' }); q.position.set(0, 150, 0); G.add(q); this.qs.push(q); this.huds.push(q); }
    if (st === 'locked') { const l = this.lockSprite(o.lockK || 1.4); l.position.set(0, 70, 0); G.add(l); }
    if (o.label) { const s = this.sprite(o.label, { size: 46, pill: true, bg: st === 'done' ? INK : '#FFF3D1', color: st === 'done' ? '#FFF3D1' : INK, k: 1.25 }); s.position.set(0, 215, -60); s.material.depthTest = false; s.renderOrder = 999; G.add(s); this.huds.push(s); }
    return G;
  }

  private decor(p: PlaceCfg, G: THREE.Group, fade: boolean) {
    const fadeIn = (m: THREE.Material) => { if (fade) { m.transparent = true; m.opacity = 0; this.tweens.push({ m: [m], t0: now(), dur: this.reducedMotion ? 0.6 : 2.6 }); } return m; };
    if (p.theme === 'river') {
      const m = fade ? fadeIn(this.own(new THREE.MeshBasicMaterial({ color: '#ffffff' }))) : this.basic('#ffffff');
      [-40, 10, 60].forEach((z, i) => { const pts: THREE.Vector3[] = []; for (let x = -150; x <= 150; x += 10) pts.push(new THREE.Vector3(x, 5, z + Math.sin(x / 16) * 6)); const w = new THREE.Mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 2.2, 5, false)), m); G.add(w); this.anims.push({ o: w, i }); });
    }
    if (p.theme === 'garden') { const m = this.toon('#4E9F3D'); [[-170, -30], [150, -60], [-60, 80], [190, 60], [20, -90], [-190, 50], [80, 90]].forEach(([x, z]) => { const c = new THREE.Mesh(this.cone ||= new THREE.ConeGeometry(6, 16, 6), m); c.position.set(x, 11, z); G.add(c); c.userData.plant = { pop: 0 }; this.plants.push(c); }); }
    if (p.theme === 'market') { ['#F26A2E', '#E9A3C0', '#8FD6D0', '#FFC93C', '#9BD770'].forEach((col, i) => { const c = new THREE.Mesh(this.box ||= new THREE.BoxGeometry(16, 12, 16), this.toon(col)); c.position.set(-180 + i * 90, 9, i % 2 ? -95 : 95); c.rotation.y = i * 0.5; G.add(c); }); }
    if (p.theme === 'rooftop') { const m = this.toon('#C8573E'); [[-185, -60], [185, -50], [-150, 90], [170, 80]].forEach(([x, z]) => { const c = new THREE.Mesh(this.box ||= new THREE.BoxGeometry(16, 12, 16), m); c.scale.set(0.8, 2, 0.8); c.position.set(x, 15, z); G.add(c); }); }
  }

  private month(places: PlaceCfg[], o: { pick?: boolean; labels?: boolean; lite?: boolean; kind?: string } = {}) {
    const G = new THREE.Group(), alive = places.length > 0 && places.every(p => p.status === 'done');
    // while the map is in progress the two of them stroll on this week's place (or a finished one), and across the whole land once it is finished
    const cur = places.findIndex(p => p.status === 'current'), walkI = o.pick && !alive ? (cur >= 0 ? cur : places.findIndex(p => p.status === 'done')) : -1;
    places.forEach((p, i) => {
      const lbl = p.status === 'done' ? p.name : p.status === 'current' ? 'This week · ' + Math.max(0, PAIRS - p.pairs.length) + ' to go' : null;
      const g = this.island(p, { label: o.labels !== false ? lbl : null, q: true, pick: o.pick && p.status !== 'locked' ? { type: 'place', pi: i } : null, lockK: 1.6, walk: i === walkI, walkH: 80 });
      g.position.set(MPOS[i][0], 0, MPOS[i][1]); G.add(g);
    });
    if (alive) { this.land(G, o.lite); if (o.pick) this.mapWalkers(o.kind || '', G, 74); }
    const pts = [[-760, -420], ...MPOS, [760, 520]].map(([x, z]) => new THREE.Vector3(x, alive ? -19 : -10, z));
    const curve = new THREE.CatmullRomCurve3(pts), n = Math.round(curve.getLength() / 34), dm = this.toon('#FFC93C');
    curve.getSpacedPoints(n).forEach(pt => { if (alive && !onLand(pt.x, pt.z)) return; const s = new THREE.Mesh(this.dot ||= new THREE.SphereGeometry(7, 10, 8), dm); s.position.copy(pt); G.add(s); });
    G.userData.alive = alive; return G;
  }

  private edge(pts: THREE.Vector3[], r: number) { const cp = new THREE.CurvePath<THREE.Vector3>(); for (let i = 0; i < pts.length; i++) cp.add(new THREE.LineCurve3(pts[i], pts[(i + 1) % pts.length])); return new THREE.TubeGeometry(cp as any, pts.length * 6, r, 5, false); }

  /** The land a finished map stands on (lite: the small copy in the stack, without sea, clouds and compass). */
  private land(G: THREE.Group, lite = false) {
    const c = this.landGeo ||= (() => {
      const sh = new THREE.Shape(); LAND.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath();
      const land = new THREE.ExtrudeGeometry(sh, { depth: 44, bevelEnabled: true, bevelThickness: 4, bevelSize: 6, bevelSegments: 1 }); land.rotateX(Math.PI / 2); land.translate(0, -30, 0);
      const river = new THREE.CatmullRomCurve3(RIV.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const flow = new THREE.CapsuleGeometry(2.6, 16, 3, 6); flow.rotateX(Math.PI / 2);
      const trunk = new THREE.CylinderGeometry(3.5, 4.5, 22, 6); trunk.translate(0, 11, 0);
      const ring = new THREE.TorusGeometry(1, 0.05, 6, 48); ring.rotateX(Math.PI / 2);
      return {
        land, top: this.edge(LAND.map(([x, z]) => new THREE.Vector3(x, -25.4, z)), 2.4), bot: this.edge(LAND.map(([x, z]) => new THREE.Vector3(x, -78, z)), 2),
        river, riverGeo: new THREE.TubeGeometry(river, 120, 26, 8, false), flow, trunk, ring,
        crown: new THREE.IcosahedronGeometry(19, 0), pine: new THREE.ConeGeometry(16, 38, 7), puff: new THREE.IcosahedronGeometry(1, 1), disc: new THREE.CircleGeometry(1, 24),
        mtn: MTN.map(([, , r, h]) => [new THREE.ConeGeometry(r, h, 7), new THREE.ConeGeometry(r * 0.4, h * 0.4, 7)]),
      };
    })();
    G.add(new THREE.Mesh(c.land, [this.toon('#9BDB6A'), this.toon('#4E9F3D')]));
    G.add(new THREE.Mesh(c.top, this.basic(INK)), new THREE.Mesh(c.bot, this.basic(INK)));
    const rv = new THREE.Mesh(c.riverGeo, this.toon('#5AB0F0')); rv.scale.y = 0.06; rv.position.y = -25; G.add(rv);
    for (let i = 0; i < 16; i++) { const f = new THREE.Mesh(c.flow, this.basic('#ffffff')); G.add(f); this.flows.push({ o: f, i, n: 16, curve: c.river }); }
    const pond = new THREE.Mesh(c.disc, this.toon('#5AB0F0')); pond.rotation.x = -Math.PI / 2; pond.scale.setScalar(POND[2]); pond.position.set(POND[0], -24.6, POND[1]); G.add(pond);
    const pr = new THREE.Mesh(c.ring, this.basic(INK)); pr.scale.set(POND[2], 30, POND[2]); pr.position.set(POND[0], -24.5, POND[1]); G.add(pr);
    for (let i = 0; i < 2; i++) { const m = this.own(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true })), r = new THREE.Mesh(c.ring, m); r.position.set(POND[0], -24.2, POND[1]); G.add(r); this.ripples.push({ o: r, m, ph: i * 0.5, R: POND[2] }); }
    MTN.forEach(([x, z, , h], i) => {
      const m = new THREE.Mesh(c.mtn[i][0], this.toon('#6FA8DC')); m.position.set(x, -26 + h / 2, z); G.add(m);
      const snow = new THREE.Mesh(c.mtn[i][1], this.toon('#ffffff')); snow.position.set(x, -26 + h - h * 0.2 + 0.5, z); G.add(snow);
    });
    const R = rnd(11), clear = (x: number, z: number, pad: number) => onLand(x, z) && !MPOS.some(([cx, cz]) => Math.abs(x - cx) < 250 + pad && Math.abs(z - cz) < 150 + pad) && Math.abs(x - riverX(z)) > 50 && !MTN.some(([mx, mz, mr]) => Math.hypot(x - mx, z - mz) < mr + 24) && Math.hypot(x - POND[0], z - POND[1]) > POND[2] + 24;
    const greens = ['#4FAE3E', '#6CC24A', '#3E9B48', '#86CF5A'], fall = ['#F29B38', '#F5C84C', '#E8743B'];
    let placed = 0, tries = 0;
    while (placed < (lite ? 30 : 48) && tries < 3000) {
      tries++; const x = -780 + R() * 1560, z = -510 + R() * 1090; if (!clear(x, z, 12)) continue; placed++;
      const tg = new THREE.Group(); tg.position.set(x, -26, z); tg.scale.setScalar(0.8 + R() * 0.5);
      if ((x > 380 && z < -150) || R() < 0.25) { const a = new THREE.Mesh(c.pine, this.toon('#2F8F4E')); a.position.y = 22; const b = new THREE.Mesh(c.pine, this.toon('#3FA35A')); b.position.y = 40; b.scale.setScalar(0.75); tg.add(a, b); }
      else { tg.add(new THREE.Mesh(c.trunk, this.toon('#8A5A3B'))); const pal = x < -420 ? fall : greens; const cr = new THREE.Mesh(c.crown, this.toon(pal[Math.floor(R() * pal.length)])); cr.position.y = 34; tg.add(cr); }
      G.add(tg); this.sway.push({ o: tg, ph: R() * 6 });
    }
    let flock = 0; tries = 0;
    while (flock < 5 && tries < 2000) {
      tries++; const x = -700 + R() * 1400, z = -480 + R() * 1000; if (!clear(x, z, 30)) continue; flock++;
      const s = new THREE.Group(), body = new THREE.Mesh(c.puff, this.toon('#ffffff')), hd = new THREE.Mesh(c.puff, this.toon(INK));
      body.scale.set(13, 10, 10); body.position.y = 12; hd.scale.setScalar(5.5); hd.position.set(13, 15, 0); s.add(body, hd); s.position.set(x, -26, z); G.add(s);
      this.sheep.push({ o: s, cx: x, cz: z, ph: R() * 6 });
    }
    if (lite) return;
    const sea = new THREE.Mesh(c.disc, this.toon('#7FD0C9')); sea.rotation.x = -Math.PI / 2; sea.scale.setScalar(3200); sea.position.y = -82; G.add(sea);
    for (let i = 0; i < 4; i++) {
      const cl = new THREE.Group(); [[0, 0, 30], [30, 6, 24], [-28, 2, 22], [10, 16, 22]].forEach(([dx, dy, r]) => { const p = new THREE.Mesh(c.puff, this.toon('#ffffff')); p.scale.setScalar(r); p.position.set(dx, dy, 0); cl.add(p); });
      const x0 = -900 + i * 470; cl.position.set(x0, 250 + (i % 2) * 50, -360 + i * 240); G.add(cl); this.clouds.push({ o: cl, x0, v: 12 + i * 3 });
    }
    const cp = this.compass(); cp.position.set(640, 0, 580); G.add(cp); this.huds.push(cp);
  }

  private compass() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 200; const x = cv.getContext('2d')!;
    x.fillStyle = '#FFC93C'; x.strokeStyle = INK; x.lineWidth = 4;
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => { x.beginPath(); x.moveTo(100 + dx * 80, 100 + dy * 80); x.lineTo(100 + dy * 22, 100 - dx * 22); x.lineTo(100 - dy * 22, 100 + dx * 22); x.closePath(); x.fill(); x.stroke(); });
    x.fillStyle = INK; x.font = '900 34px Urbanist, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('N', 100, 18); x.fillText('S', 100, 188);
    const tex = this.own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))); s.scale.set(170, 170, 1); return s;
  }

  // ---- the caricatures they drew of each other, walking around ----
  private face(url: string, h: number) {
    let tex = this.faceTex.get(url);
    if (!tex) { tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace; this.faceTex.set(url, tex); }
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.04 })));
    s.center.set(0.5, 0.04); s.scale.set(h, h, 1); s.renderOrder = 5; return s;
  }
  /** One of them walks a loop of stops, pausing at each to sniff, look or wave. */
  private walker(G: THREE.Group, who: 'd' | 'a', h: number, pts: Stop[], o: { v?: number; off?: number; hop?: boolean; y0?: number; ground: Ground; speed?: number }) {
    const s = this.face(this.cfg!.walkers![who], h), legs: Walker['legs'] = [], v = o.v || 40; let t0 = 0; G.add(s);
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length], d = Math.hypot(b.x - a.x, (b.y || 0) - (a.y || 0), b.z - a.z), dur = Math.max(0.01, d / v), pause = a.p || 0; legs.push({ a, b, t0, pause, dur }); t0 += pause + dur; });
    const w: Walker = { s, G, who, legs, total: t0, h, off: o.off || 0, face: 1, hop: !!o.hop, y0: o.y0 ?? 3, ground: o.ground, speed: o.speed || 140, waveUntil: 0, parked: null };
    s.userData.walker = w; this.pickables.push(s); this.walkers.push(w);
  }
  private islandWalkers(theme: string, G: THREE.Group, h: number, poly: number[][]) {
    if (!this.cfg?.walkers) return;
    const P = (x: number, z: number, p: number, act: Stop['act'], f?: 1 | -1): Stop => ({ x, z, p, act, f });
    // walking around, they keep a step away from the island's edge
    const m = 22, ground: Ground = (x, z) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dz]) => inRing(poly, x + dx, z + dz)) ? 0 : null;
    if (theme === 'garden') {
      // from flower to flower, stopping to smell each one (the green buds in decor())
      const F = [P(-152, -30, 2.4, 'sniff', -1), P(-176, 50, 2.4, 'sniff', 1), P(-78, 80, 2.4, 'sniff', -1), P(62, 90, 2.4, 'sniff', -1), P(172, 60, 2.4, 'sniff', -1), P(132, -60, 2.4, 'sniff', 1), P(38, -90, 2.4, 'sniff', -1)];
      this.walker(G, 'd', h, F, { v: 34, ground });
      this.walker(G, 'a', h * 0.9, F.slice(3).concat(F.slice(0, 3)).map(q => ({ ...q, p: 1.4 })), { v: 62, hop: true, off: 1.5, ground });
    } else if (theme === 'river') {
      // along the bank, watching the water; the little one waves
      this.walker(G, 'd', h, [P(-150, 88, 3, 'look', 1), P(-20, 92, 2.5, 'look', 1), P(120, 84, 3, 'look', -1)], { v: 30, ground });
      this.walker(G, 'a', h * 0.9, [P(150, 96, 1.6, 'wave'), P(-40, 100, 0.8, 'look', -1), P(-170, 92, 1.6, 'wave'), P(30, 98, 0.8, 'look', 1)], { v: 70, hop: true, off: 2, ground });
    } else {
      const L = [P(-150, 60, 1.8, 'look', 1), P(0, 90, 1, null), P(150, 40, 1.8, 'look', -1), P(60, -60, 1, null), P(-100, -50, 1.8, 'look', 1)];
      this.walker(G, 'd', h, L, { v: 34, ground });
      this.walker(G, 'a', h * 0.9, L.slice(2).concat(L.slice(0, 2)), { v: 56, hop: true, ground });
    }
  }
  /** A finished map: on hilly maps they climb the big hill and wave from the top, elsewhere they walk round the pond. */
  private mapWalkers(kind: string, G: THREE.Group, h: number) {
    if (!this.cfg?.walkers) return;
    // anywhere on the land (up the hills too), but not into the pond or off the edge
    const ground: Ground = (x, z) => [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]].every(([dx, dz]) => onLand(x + dx, z + dz)) && Math.hypot(x - POND[0], z - POND[1]) > POND[2] + 8 ? terrain(x, z) : null, speed = 230;
    if (/hill|forest|desert/i.test(kind)) {
      const [mx, mz, r, hh] = MTN[0], up: Stop[] = [];
      for (let i = 0; i <= 8; i++) { const u = (i / 8) * 0.8, a = Math.PI * (0.88 - (i / 8) * 0.6), rad = r * (1 - u) + 10; up.push({ x: mx + Math.cos(a) * rad, z: mz + Math.sin(a) * rad, y: -26 + hh * u }); }
      up[up.length - 1] = { ...up[up.length - 1], p: 3.2, act: 'wave' };
      const route: Stop[] = [{ x: mx - 150, z: mz + 120, y: -26, p: 1.5, act: 'look', f: 1 }, ...up, ...up.slice(1, -1).reverse().map(q => ({ ...q }))];
      this.walker(G, 'd', h, route, { v: 26, y0: 0, ground, speed });
      this.walker(G, 'a', h * 0.85, route, { v: 26, y0: 0, hop: true, off: 3.2, ground, speed });
    } else {
      const [px, pz, pr] = POND, R = pr + 22, ring: Stop[] = [];
      for (let i = 0; i < 6; i++) { const a = -Math.PI * 0.45 + (i / 5) * Math.PI * 0.9; ring.push({ x: px + Math.cos(a) * R, z: pz + Math.sin(a) * R, y: -26, p: i % 2 ? 0 : 2, act: i === 2 ? 'wave' : 'look', f: -1 }); }
      const route = [...ring, ...ring.slice(1, -1).reverse().map(q => ({ ...q }))];
      this.walker(G, 'd', h, route, { v: 22, y0: 0, ground, speed });
      this.walker(G, 'a', h * 0.85, route, { v: 22, y0: 0, hop: true, off: 4, ground, speed });
    }
  }

  private board(m: MonthCfg, i: number) {
    const B = new THREE.Group(); B.userData.pick = { type: 'month', mi: i };
    const cream = this.toon('#FFF3D1', m.current ? 0.35 : 1), edge = this.toon('#E6CF92', m.current ? 0.3 : 1);
    const slab = new THREE.Mesh(this.slabGeo ||= new THREE.BoxGeometry(1700, 28, 1300), [edge, edge, cream, edge, edge, edge]); slab.position.y = -14; B.add(slab);
    const eg = this.own(new THREE.EdgesGeometry(this.slabGeo));
    if (m.current) { const e = new THREE.LineSegments(eg, this.own(new THREE.LineDashedMaterial({ color: INK, dashSize: 24, gapSize: 18 }))); e.computeLineDistances(); e.position.y = -14; B.add(e); }
    else { const e = new THREE.LineSegments(eg, this.own(new THREE.LineBasicMaterial({ color: INK }))); e.position.y = -14; B.add(e); }
    const mg = this.month(m.places, { labels: false, lite: true }); mg.scale.setScalar(0.85); mg.position.y = mg.userData.alive ? 72 : 34; B.add(mg);
    if (m.current) mg.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const fix = (x: THREE.Material) => { const c = this.own(x.clone()); c.transparent = true; c.opacity = Math.min(x.opacity, 0.5); c.depthWrite = false; return c; }; mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material); } });
    const s = this.sprite(m.name, { size: 52, pill: true, bg: m.current ? '#FFF3D1' : INK, color: m.current ? INK : '#FFF3D1', k: 1.3 }); s.position.set(-990, 40, 0); B.add(s);
    this.pickables.push(B); return B;
  }

  private build(cfg: MapConfig) {
    this.cfg = cfg; this.root.clear(); this.clearOwned();
    this.items = []; this.tweens = []; this.anims = []; this.qs = []; this.pickables = [];
    this.flows = []; this.sway = []; this.sheep = []; this.clouds = []; this.ripples = []; this.walkers = []; this.plants = []; this.huds = [];
    this.bubbles.forEach(b => this.scene.remove(b.s)); this.bubbles = [];
    if (this.pov) { this.pov = null; this.camera.fov = 30; this.camera.updateProjectionMatrix(); this.mode = null; this.joyEl.style.display = 'none'; this.keys.clear(); this.onPov(null); }
    if (cfg.mode === 'place') this.root.add(this.island(cfg.place, { fresh: cfg.fresh, fade: cfg.fade, q: true, S: 76, walk: true }));
    else if (cfg.mode === 'month') this.root.add(this.month(cfg.places, { pick: true, kind: cfg.kind }));
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

  /** The point on the ground (y = 0) under the pointer, or null when it points at the sky. */
  private groundAt(e: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  /** Dragging can't lose the map: the point the camera looks at stays over the island / month. */
  private keepInView() {
    if (!this.mode || this.mode === 'stack') return;
    const c = this.controls, t = c.target, [bx, bz] = this.mode === 'place' ? [280, 190] : [800, 600];
    const x = clamp(t.x, -bx, bx), z = clamp(t.z, -bz, bz);
    if (x === t.x && z === t.z) return;
    this.camera.position.x += x - t.x; this.camera.position.z += z - t.z; t.x = x; t.z = z;
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
    for (const h of rc.intersectObjects(this.pickables, true)) {
      let o: THREE.Object3D | null = h.object; while (o && !o.userData.pick && !o.userData.walker) o = o.parent; if (!o) continue;
      // tapping one of them: see the map through their eyes
      if (o.userData.walker) { this.setPov((o.userData.walker as Walker).who); return; }
      this.onPick(o.userData.pick); return;
    }
  }

  /** See the map through Dadi's or the grandchild's eyes (null: back to the view from above). */
  setPov(who: Pov, silent = false) {
    const cam = this.camera, W = who ? this.walkers.find(w => w.who === who) : undefined;
    if (who && !W) { this.setPov(null); return; }
    if (this.pov && W && this.pov.w === W) return;
    // the one we leave stays where we walked them to
    if (this.pov) { const o = this.pov.w; o.s.visible = true; if (W) o.parked = { x: this.pov.x, z: this.pov.z, y: this.pov.gy }; }
    if (!W) {
      this.huds.forEach(s => (s.visible = true));
      if (this.pov) { this.pov = null; this.walkers.forEach(w => { w.parked = null; w.s.visible = true; }); cam.fov = 30; cam.updateProjectionMatrix(); const m = this.mode!; this.mode = null; this.frame(m); }
      this.joyEl.style.display = 'none'; this.keys.clear(); if (!silent) this.onPov(null); return;
    }
    let x: number, z: number, gy: number;
    if (W.parked) ({ x, z, y: gy } = W.parked);
    else { x = W.s.position.x; z = W.s.position.z; gy = W.ground(x, z) ?? W.s.position.y - W.y0; }
    W.parked = null; W.s.visible = false;
    // start out looking at the other one, a few steps back so they are in view
    const other = this.walkers.find(w => w !== W); let yaw = Math.atan2(-x, -z);
    if (other) {
      const ox = other.parked ? other.parked.x : other.s.position.x, oz = other.parked ? other.parked.z : other.s.position.z;
      let dx = ox - x, dz = oz - z, dd = Math.hypot(dx, dz);
      if (dd < 1) { dx = -x; dz = -z; dd = Math.hypot(dx, dz) || 1; }
      yaw = Math.atan2(dx, dz); const need = W.h * 2.6;
      if (dd < need) { const ux = dx / dd, uz = dz / dd; for (let s = need; s >= dd; s -= 10) { const nx = ox - ux * s, nz = oz - uz * s, g = W.ground(nx, nz); if (g != null) { x = nx; z = nz; gy = g; break; } } }
    }
    this.pov = { w: W, x, z, gy, yaw, pitch: -0.1, t0: now(), sp: cam.position.clone(), sq: cam.quaternion.clone(), sf: cam.fov, walkT: 0 };
    this.controls.enabled = false; this.joyEl.style.display = 'block'; this.huds.forEach(s => (s.visible = false));
    if (!silent) this.onPov(who);
  }

  private povStep(dt: number, n: number) {
    const P = this.pov!, w = P.w, cam = this.camera, k = this.keys; let jx = this.joy.x, jy = this.joy.y;
    if (k.has('w') || k.has('arrowup')) jy += 1; if (k.has('s') || k.has('arrowdown')) jy -= 1; if (k.has('a') || k.has('arrowleft')) jx -= 1; if (k.has('d') || k.has('arrowright')) jx += 1;
    if (k.has('q')) P.yaw += dt * 1.8; if (k.has('e')) P.yaw -= dt * 1.8;
    const mag = Math.hypot(jx, jy); if (mag > 1) { jx /= mag; jy /= mag; }
    if (mag > 0.05) {
      // slide along the edge instead of stepping off it
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = -fz, rz = fx, sp = w.speed * dt, nx = P.x + (fx * jy + rx * jx) * sp, nz = P.z + (fz * jy + rz * jx) * sp, off = w.ground(P.x, P.z) == null;
      if (off || w.ground(nx, nz) != null) { P.x = nx; P.z = nz; } else if (w.ground(nx, P.z) != null) P.x = nx; else if (w.ground(P.x, nz) != null) P.z = nz;
      P.walkT += dt * Math.min(1, mag);
    }
    const g = w.ground(P.x, P.z); if (g != null) P.gy += (g - P.gy) * Math.min(1, dt * 10);
    const bob = mag > 0.05 && !this.reducedMotion ? Math.sin(P.walkT * (w.hop ? 11 : 8)) * (w.hop ? 4 : 2.2) : 0;
    w.G.updateWorldMatrix(true, false);
    const eye = w.G.localToWorld(this.eye.set(P.x, P.gy + w.y0 + w.h * 0.78 + bob, P.z)), cp = Math.cos(P.pitch);
    const tg = this.look.set(eye.x + Math.sin(P.yaw) * cp, eye.y + Math.sin(P.pitch), eye.z + Math.cos(P.yaw) * cp);
    // glide down from above into their eyes
    const b = this.reducedMotion ? 1 : Math.min(1, (n - P.t0) / 0.9);
    if (b < 1) { const e = b * b * (3 - 2 * b); this.dc.position.copy(eye); this.dc.lookAt(tg); cam.position.lerpVectors(P.sp, eye, e); cam.quaternion.slerpQuaternions(P.sq, this.dc.quaternion, e); cam.fov = P.sf + (64 - P.sf) * e; cam.updateProjectionMatrix(); }
    else { if (cam.fov !== 64) { cam.fov = 64; cam.updateProjectionMatrix(); } cam.position.copy(eye); cam.lookAt(tg); }
  }

  private bubble(text: string, pos: THREE.Vector3, o: { bg?: string; color?: string } = {}) {
    const s = this.sprite(text, { size: 44, pill: true, bg: o.bg || '#FFF3D1', color: o.color || INK, k: 0.42 }); s.material.depthTest = false; s.renderOrder = 1000; s.position.copy(pos);
    this.scene.add(s); this.bubbles.push({ s, t0: now(), y0: pos.y });
  }

  /** Walking around: tap a drawing, a flower or the other one to say hello. */
  private povPick(e: PointerEvent) {
    const P = this.pov!, r = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const hit = rc.intersectObjects([...this.items.map(i => i.base), ...this.walkers.filter(w => w !== P.w).map(w => w.s), ...this.plants], true)[0]; if (!hit) return;
    let o: THREE.Object3D | null = hit.object; while (o && !o.userData.item && !o.userData.walker && !o.userData.plant) o = o.parent; if (!o) return;
    const n = now(), names = this.cfg?.names || { d: 'Dadi', a: 'Aarav' }, wp = o.getWorldPosition(new THREE.Vector3());
    if (hit.distance > (P.w.speed > 200 ? 420 : 330)) { this.bubble('Walk closer!', wp.add(new THREE.Vector3(0, 60, 0))); return; }
    if (o.userData.walker) { const w = o.userData.walker as Walker; w.waveUntil = n + 2.4; this.bubble('Hi, ' + names[P.w.who] + '!', wp.add(new THREE.Vector3(0, w.h * 1.1, 0)), { bg: w.who === 'd' ? DADI : CHILD, color: '#FFF3D1' }); return; }
    if (o.userData.plant) { o.userData.plant.pop = n; this.bubble('Mmm, flowers!', wp.add(new THREE.Vector3(0, 34, 0))); return; }
    const it = o.userData.item as Item, label = (it.d.label || it.d.kind || '').trim();
    it.pop = n; this.bubble(SAY[(it.d.kind || '').toLowerCase()] || (label ? label[0].toUpperCase() + label.slice(1) + '!' : 'Hello!'), wp.add(new THREE.Vector3(0, it.S * 1.25, 0)));
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
    else if (this.pov) this.povStep(Math.min(0.05, t - (this.lt || t)), n);
    else this.controls.update();
    this.lt = t;
    const boil = this.reducedMotion ? true : Math.floor(t / 0.22) % 2 === 0;
    for (const it of this.items) {
      it.oa.visible = boil; it.ob.visible = !boil; this.animate(it, t);
      // tapped while walking around: a happy spin
      if (it.pop) { const k = (n - it.pop) / 0.9; if (k < 1) { it.sc.scale.setScalar((it.S / 64) * (1 + 0.35 * Math.sin(k * Math.PI))); it.sc.rotation.y = (1 - Math.pow(1 - k, 3)) * Math.PI * 2; } else { it.pop = 0; it.sc.scale.setScalar(it.S / 64); it.sc.rotation.y = 0; } }
      if (it.rise) { const k = this.reducedMotion ? 1 : Math.min(1, Math.max(0, (n - it.rise) / 1.4)); it.sc.scale.setScalar(Math.max(0.0001, (it.S / 64) * easeBack(k))); it.mover.rotation.x = -(1 - k) * (1 - k) * Math.PI / 2; if (k >= 1) it.rise = 0; }
    }
    for (const tw of this.tweens) { const k = Math.min(1, (n - tw.t0) / tw.dur); tw.m.forEach(m => { m.opacity = k; if (k >= 1) { m.transparent = false; m.needsUpdate = true; } }); }
    this.tweens = this.tweens.filter(tw => n - tw.t0 < tw.dur);
    for (const a of this.anims) a.o.position.x = this.reducedMotion ? 0 : ((t * 16 + a.i * 20) % 40) - 20;
    const A = this.reducedMotion ? 0.25 : 1, tv = this.tv;
    for (const f of this.flows) { const u = (t * 0.02 * A + f.i / f.n) % 1, p = f.curve.getPointAt(u), d = f.curve.getTangentAt(u); f.o.position.set(p.x + Math.sin(f.i * 2.3) * 9, -23.4, p.z); tv.set(f.o.position.x + d.x, -23.4, f.o.position.z + d.z); f.o.lookAt(tv); }
    for (const s of this.sway) s.o.rotation.z = Math.sin(t * 0.8 + s.ph) * 0.05 * A;
    for (const s of this.sheep) { const k = t * A; s.o.position.set(s.cx + Math.sin(k * 0.15 + s.ph) * 28, -26 + Math.abs(Math.sin(k * 2 + s.ph)) * 2, s.cz + Math.cos(k * 0.12 + s.ph) * 18); s.o.rotation.y = Math.sin(k * 0.15 + s.ph) > 0 ? 0 : Math.PI; }
    for (const c of this.clouds) c.o.position.x = (((c.x0 + t * c.v * A + 900) % 1800) + 1800) % 1800 - 900;
    for (const r of this.ripples) { const k = (t * 0.25 * A + r.ph) % 1; r.o.scale.set(r.R * (0.3 + k * 0.65), 30, r.R * (0.3 + k * 0.65)); r.m.opacity = (1 - k) * 0.8; }
    for (const c of this.plants) { const p = c.userData.plant; if (!p.pop) continue; const k = (n - p.pop) / 0.8, s = Math.sin(k * Math.PI); if (k < 1) c.scale.set(1 + 0.5 * s, 1 + 0.8 * s, 1 + 0.5 * s); else { p.pop = 0; c.scale.set(1, 1, 1); } }
    for (const b of this.bubbles) { const k = (n - b.t0) / 1.9; b.s.position.y = b.y0 + k * 24; b.s.material.opacity = k < 0.7 ? 1 : Math.max(0, (1 - k) / 0.3); if (k >= 1) { this.scene.remove(b.s); b.dead = true; } }
    this.bubbles = this.bubbles.filter(b => !b.dead);
    for (const w of this.walkers) {
      if (this.pov && this.pov.w === w) continue;
      const waving = w.waveUntil > n;
      // after switching, the one left behind stays where they were walked to
      if (w.parked) { const bob = waving ? Math.abs(Math.sin(t * 6)) * 14 : 0, rot = waving ? Math.sin(t * 6) * 0.1 : Math.sin(t * 1.5 + w.off) * 0.03; w.s.position.set(w.parked.x, w.parked.y + w.y0 + bob * A, w.parked.z); w.s.material.rotation = rot * A; continue; }
      const tt = (((t + w.off) % w.total) + w.total) % w.total, L = w.legs.find(l => tt < l.t0 + l.pause + l.dur) || w.legs[w.legs.length - 1], lt = tt - L.t0;
      let x: number, y: number, z: number, mv = false, act: Stop['act'] = null, bob = 0, rot = 0;
      if (lt < L.pause) { x = L.a.x; y = L.a.y || 0; z = L.a.z; act = L.a.act; if (L.a.f) w.face = L.a.f; }
      else { const k = Math.min(1, (lt - L.pause) / L.dur); x = L.a.x + (L.b.x - L.a.x) * k; y = (L.a.y || 0) + ((L.b.y || 0) - (L.a.y || 0)) * k; z = L.a.z + (L.b.z - L.a.z) * k; mv = true; const dx = L.b.x - L.a.x; if (Math.abs(dx) > 2) w.face = dx > 0 ? 1 : -1; }
      const ph = t * (w.hop ? 10 : 7) + w.off;
      if (mv) { bob = Math.abs(Math.sin(ph)) * (w.hop ? 12 : 4); rot = Math.sin(ph) * 0.08; }
      else if (act === 'sniff') { rot = -w.face * (0.32 + 0.05 * Math.sin(t * 5)); bob = Math.abs(Math.sin(t * 4)) * 1.5; }
      else if (act === 'wave') { bob = Math.abs(Math.sin(t * 6)) * 14; rot = Math.sin(t * 6) * 0.1; }
      else if (act === 'look') rot = -w.face * 0.14;
      else rot = Math.sin(t * 1.5 + w.off) * 0.03;
      if (waving) { bob = Math.abs(Math.sin(t * 6)) * 14; rot = Math.sin(t * 6) * 0.1; }
      w.s.position.set(x, y + w.y0 + bob * A, z); w.s.scale.x = w.h * w.face; w.s.material.rotation = rot * A;
    }
    for (const q of this.qs) { q.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.4); q.position.y = 150 + Math.sin(t * 1.2) * 6; }
    this.renderer.render(this.scene, this.camera);
  };
}
