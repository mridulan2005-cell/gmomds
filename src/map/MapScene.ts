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
import { loadHouse, type HouseShape } from './house';

export interface DrawCfg {
  id: string; f: string[]; s: string[]; fc?: (string | null)[]; fill: string; owner: 'd' | 'a'; motion: Motion; place: Spot;
  /** exact cut-out of the drawing + where its image sits; when present the drawing is shown exactly as drawn */
  sil?: { outer: string[]; holes: string[] }; artBox?: [number, number, number, number]; art?: boolean;
  /** what it is ("cat", "a ginger cat"), for what they say when it is tapped */
  kind?: string; label?: string;
}
export interface PlaceCfg { name: string; shape: string; color: string; theme: string; status: 'locked' | 'current' | 'done'; pairs: [DrawCfg, DrawCfg][]; /** pairs that finish it (PAIRS when missing) */ total?: number }
/** How far a place is built (0…4 scenery stages) after n of its total pairs. */
const stageOf = (n: number, total: number) => (n >= total ? 4 : Math.max(0, Math.min(4, Math.round((n * 4) / total))));
export interface MonthCfg { name: string; current: boolean; places: PlaceCfg[]; dream?: DreamCfg }
export type RoomKey = 'lr' | 'kitchen' | 'park';
export interface RoomCfg { status: 'locked' | 'current' | 'done'; n: number; pairs: [DrawCfg | null, DrawCfg | null][] }
/** The Dream House: rooms that build up with their prompts, and the house rebuilt from their drawing of it. */
export interface DreamCfg {
  rooms: Partial<Record<RoomKey, RoomCfg>>;
  /** id: a scanned drawing (its image comes from artLoader); url: a sample picture */
  house: { status: 'locked' | 'current' | 'done'; id?: string; url?: string };
  /** the whole map is finished: it comes alive (and a pin appears at its edge, until the bridge is built) */
  alive?: boolean;
  /** the bridge from the pin to the next map is built */
  bridged?: boolean;
}
export type DreamFocus = 'all' | 'lr' | 'kitchen' | 'house' | 'park' | 'bridge';
/** the caricatures they drew of each other (image URLs): d = Dadi, a = the grandchild */
export interface Walkers { d: string; a: string }
export type MapConfig = (
  | { mode: 'place'; key: string; place: PlaceCfg; fresh?: number; fade?: boolean }
  | { mode: 'month'; key: string; places: PlaceCfg[]; kind?: string }
  | { mode: 'stack'; key: string; months: MonthCfg[] }
  /** fresh: the newest drawing(s), which rise in (i = the prompt in that room); peek: the roof is lifted off */
  | { mode: 'dream'; key: string; dream: DreamCfg; focus?: DreamFocus; fresh?: { room: RoomKey | 'house' | 'bridge'; i: number } | null; peek?: boolean }
) & { walkers?: Walkers; names?: { d: string; a: string } };
type DreamMapCfg = Extract<MapConfig, { mode: 'dream' }>;
export type Pick = { type: 'place'; pi: number } | { type: 'month'; mi: number } | { type: 'room'; room: RoomKey | 'house' }
  /** a locked place's padlock (mi: which map, when tapped in the stack) */
  | { type: 'lock'; mi?: number; pi?: number; room?: RoomKey | 'house' };
/** whose eyes the map is seen through: d = Dadi, a = the grandchild, null = the usual view from above */
/** walking around the map in first person, as a third character (p), not as Dadi or the grandchild */
export type Pov = 'p' | null;

const DADI = '#2F5FD0', CHILD = '#E4572E', INK = '#3d2b22', DEPTH = 6, BT = 2.4, STEP = 900;
const SLOTS = [[120, 110], [245, 100], [370, 110], [90, 205], [200, 212], [310, 205], [420, 200]];
// a place now finishes with four pairs: spread them over the island (older places with seven keep SLOTS)
const SLOTS4 = [[130, 105], [345, 100], [150, 205], [360, 200]];
const MPOS = [[-380, -250], [330, -180], [-330, 210], [380, 280]];
// A finished map comes alive: its four islands sit on one piece of land with a river, a pond, hills, trees and sheep.
const LAND = [[-700, -380], [-560, -480], [-250, -440], [-120, -510], [120, -450], [300, -480], [520, -430], [720, -300], [700, -80], [780, 60], [720, 200], [760, 420], [570, 560], [300, 530], [100, 580], [-120, 500], [-360, 540], [-610, 480], [-740, 300], [-680, 120], [-780, -60], [-710, -200]];
const RIV = [[-30, -620], [10, -330], [-40, -60], [30, 180], [-20, 420], [10, 660]];
/**
 * Hand-drawn scenery for finished maps (public/scenery): image aspect (w/h), where its foot is (cx, cy as
 * fractions from the left and from the bottom of the image) and how much of the image's height is drawing.
 */
const PIC: Record<string, { a: number; cx: number; cy: number; vis: number }> = {
  'tree-leafy': { a: 249 / 529, cx: 0.41, cy: 0.02, vis: 0.96 }, 'tree-pine': { a: 213 / 529, cx: 0.57, cy: 0.066, vis: 0.74 },
  'tree-bushy': { a: 213 / 529, cx: 0.49, cy: 0.093, vis: 0.75 }, 'tree-palms': { a: 297 / 529, cx: 0.5, cy: 0.21, vis: 0.76 },
  'rocks-pair': { a: 648 / 258, cx: 0.5, cy: 0.21, vis: 0.79 }, 'rock-tall': { a: 459 / 276, cx: 0.5, cy: 0.07, vis: 0.79 },
  dog: { a: 327 / 261, cx: 0.45, cy: 0.04, vis: 0.96 }, cat: { a: 398 / 261, cx: 0.52, cy: 0.0, vis: 0.86 },
  'bird-green': { a: 413 / 160, cx: 0.48, cy: 0.5, vis: 0.7 }, 'birds-pair': { a: 660 / 241, cx: 0.5, cy: 0.5, vis: 0.93 },
};
const MTN = [[655, -200, 80, 150], [-655, -10, 64, 120], [580, -370, 58, 105]];
const POND = [575, 60, 52];
function onLand(x: number, z: number) { let c = false; for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) { const [xi, zi] = LAND[i], [xj, zj] = LAND[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** height of the land (with its hills) at a spot */
function terrain(x: number, z: number) { let y = -26; for (const [mx, mz, r, hh] of MTN) { const d = Math.hypot(x - mx, z - mz); if (d < r) y = Math.max(y, -26 + hh * (1 - d / r)); } return y; }
const inRing = (poly: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
/** what they say when you tap something while walking around */
const SAY: Record<string, string> = { cat: 'Meow!', bird: 'Tweet tweet!', fish: 'Splash!', mango: 'Yum, a mango!', flower: 'Mmm, smells lovely!', tree: 'What a big tree!', sun: 'So warm!', moon: 'Hello, moon!', diya: 'So bright!', kite: 'Up it goes!', bell: 'Ding ding!', drum: 'Dum dum!', note: 'La la la!', boat: 'Ahoy!', waves: 'Whoosh!', chai: 'Mmm, chai!' };
// ---- the Dream House layout: the house's footprint, its rooms (their furniture and where the drawings go), the park ----
/** hand-drawn furniture (public/dream): image size, for its aspect */
const DRW: Record<string, [number, number]> = { sofa: [300, 180], rug: [300, 180], lamp: [120, 300], window: [220, 220], shelf: [200, 260], sidetable: [140, 150], plant: [120, 210], frame: [150, 120], stove: [320, 210], fridge: [140, 300], table: [320, 200], bench: [280, 160], swing: [260, 260], lamppost: [80, 300], play: [400, 281] };
/** hand-drawn creatures, grass and trees (public/nature): image size */
const NAT: Record<string, [number, number]> = { bee: [230, 203], beetle: [169, 174], bfly1: [184, 204], bfly2: [287, 239], bfly3: [243, 227], dfly1: [293, 257], dfly2: [298, 222], fish1: [261, 252], fish2: [458, 168], fish3: [339, 190], fish4: [323, 298], fish5: [316, 255], fish6: [304, 259], grass1: [221, 131], grass2: [189, 178], grass3: [105, 151], grass4: [105, 140], grass5: [84, 110], grass6: [124, 105], grass7: [146, 103], grass8: [128, 89], grass9: [91, 101], ladybug: [199, 206], tree1: [297, 529], tree2: [249, 529], tree3: [213, 529], tree4: [213, 529] };
/** which way each fish faces in its picture */
const FACE: Record<string, number> = { fish1: -1, fish2: -1, fish3: 1, fish4: 1, fish5: -1, fish6: 1 };
const GRASS = ['grass1', 'grass2', 'grass3', 'grass4', 'grass5', 'grass6', 'grass7', 'grass8', 'grass9'], TREES = ['tree1', 'tree2', 'tree3', 'tree4'];
/** the house's walls: x from HX0 to HX1, z from HZ0 (back) to HZ1 (front, with the door) */
const HX0 = -380, HX1 = 380, HZ0 = -330, HZ1 = 10;
type Furn = [string, number, number, number, number, number?, number?]; // picture, from which prompt (1…4), x, z, height, y, flat
const ROOMS: Record<RoomKey, { x: number; z: number; w: number; d: number; floor?: 'wood' | 'tile'; furn: Furn[]; slots: [number, number, number][][] }> = {
  lr: { x: -190, z: -160, w: 380, d: 340, floor: 'wood',
    furn: [['rug', 1, -190, -150, 250, 0, 1], ['sofa', 1, -200, -268, 115], ['lamp', 1, -345, -275, 150], ['sidetable', 1, -330, -170, 62], ['window', 2, -190, -326, 120, 60], ['shelf', 3, -70, -318, 170], ['plant', 4, -40, -40, 100], ['frame', 4, -320, -326, 55, 175]],
    // 1: on the side table and the floor, 2: on the window sill (pets), 3: on top of the shelf, 4: around the room
    slots: [[[-336, -170, 62], [-290, -110, 0]], [[-225, -305, 62], [-155, -305, 62]], [[-95, -305, 170], [-45, -305, 170]], [[-250, -60, 0], [-140, -80, 0]]] },
  kitchen: { x: 190, z: -160, w: 380, d: 340, floor: 'tile',
    furn: [['stove', 1, 150, -318, 125], ['window', 2, 60, -326, 105, 150], ['fridge', 3, 330, -300, 190], ['table', 4, 190, -140, 100], ['plant', 4, 355, -40, 90]],
    // 1 and 2: on the counter, 3: by the fridge, 4: on the dining table
    slots: [[[80, -304, 90], [120, -304, 90]], [[225, -304, 90], [252, -304, 90]], [[270, -230, 0], [340, -200, 0]], [[140, -128, 52], [240, -128, 52]]] },
  park: { x: 0, z: 230, w: 1180, d: 330,
    furn: [['bench', 1, -300, 150, 80], ['play', 2, -60, 270, 120], ['swing', 2, 130, 300, 140], ['lamppost', 3, -470, 120, 150]],
    // 3: up in the air, 4: by the bridge to the fantasy island
    slots: [[[-390, 200, 0], [-240, 210, 0]], [[-150, 330, 0], [20, 335, 0]], [[140, 200, 150], [280, 170, 170]], [[900, 200, 92], [990, 250, 92]]] },
};
/** where the camera looks from for each part of the Dream House: [target, camera position] */
const DREAM_VIEW: Record<DreamFocus, [number[], number[]]> = {
  // the whole map takes in the fantasy island on the right; the park, its bridge
  all: [[190, 110, 0], [190, 1800, 2250]], lr: [[-190, 60, -160], [-190, 780, 640]], kitchen: [[190, 60, -160], [190, 780, 640]],
  park: [[260, 0, 220], [260, 1150, 1550]], house: [[0, 330, -120], [0, 1150, 2350]], bridge: [[720, 60, 220], [720, 1100, 1500]],
};
/** where the pin stands at the edge of the finished Dream House (the bridge to the next map starts there) */
const PIN = { x: 572, z: 220 };
/** their house drawings, read once */
const HOUSES = new Map<string, HouseShape>();
interface DoorState { piv: THREE.Group; x0: number; x1: number; cx: number; open: number; forced: number | null; hl: THREE.Group; tag: THREE.Sprite }
type Critter = { s: THREE.Sprite; kind: 'fly' | 'fish' | 'crawl' | 'sway'; [k: string]: any };

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

/** door: this stop is at the house's door (its x moves to wherever the door is in their drawing) */
type Stop = { x: number; z: number; y?: number; p?: number; act?: 'sniff' | 'look' | 'wave' | null; f?: 1 | -1; door?: boolean };
/** ground height where they may stand (in the walker's group), or null where they can't */
type Ground = (x: number, z: number) => number | null;
interface Walker {
  s: THREE.Sprite; G: THREE.Group; who: 'd' | 'a' | 'p'; legs: { a: Stop; b: Stop; t0: number; pause: number; dur: number }[]; total: number; h: number; off: number; face: number; hop: boolean; y0: number;
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
  // a place's scenery: what grows in, the river flowing along its bed, the kite, colour fading in
  private grows: { o: THREE.Object3D; s: THREE.Vector3; at: number }[] = [];
  private streams: { o: THREE.Object3D; curve: THREE.CatmullRomCurve3; i: number; n: number; speed: number; from: number }[] = [];
  private loops: ((t: number) => void)[] = [];
  private fx: ((n: number) => boolean)[] = [];
  private kit?: Record<string, THREE.BufferGeometry>;
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
  /** the one walking around (first person): a third character, starting near Dadi */
  private me: Walker | null = null;
  /** the pin at the edge of the finished map: reaching it on foot unlocks the bridge */
  private pinPos: { x: number; z: number } | null = null; private pinFired = false;
  onPin: () => void = () => {};
  private joy = { x: 0, y: 0 }; private keys = new Set<string>(); private joyEl: HTMLDivElement; private lt = 0;
  private eye = new THREE.Vector3(); private look = new THREE.Vector3(); private dc = new THREE.PerspectiveCamera();
  private faceTex = new Map<string, THREE.Texture>();
  private pets: THREE.Object3D[] = [];
  private critters: Critter[] = [];
  private door: DoorState | null = null;
  private landGeo?: Record<string, any>;
  private tv = new THREE.Vector3();
  private pickables: THREE.Object3D[] = [];
  private stackY = 0; private stackTarget = 0;
  private mode: string | null = null; private cfg: MapConfig | null = null; private lastKey = '';
  private raf = 0; private clock = new THREE.Clock(); private ro: ResizeObserver;
  private disc?: THREE.CircleGeometry; private dot?: THREE.SphereGeometry; private slabGeo?: THREE.BoxGeometry;
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
    J.innerHTML = '<svg viewBox="0 0 190 190" fill="none" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#hd-line)" stroke="#1E1B26" stroke-width="7"><path d="M81 28 L95 14 L109 28"/><path d="M81 162 L95 176 L109 162"/><path d="M28 81 L14 95 L28 109"/><path d="M162 81 L176 95 L162 109"/></g></svg>';
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
  private lockSprite(k = 1, pick?: Pick) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
    x.fillStyle = '#FFF3D1'; x.strokeStyle = INK; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 56, 0, 7); x.fill(); x.stroke();
    x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.moveTo(48, 60); x.lineTo(48, 48); x.arc(64, 48, 16, Math.PI, 0); x.lineTo(80, 60); x.stroke();
    x.fillStyle = '#F26A2E'; x.beginPath(); if ((x as any).roundRect) (x as any).roundRect(40, 58, 48, 36, 8); else x.rect(40, 58, 48, 36); x.fill(); x.stroke();
    const tex = this.own(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))); s.scale.set(90 * k, 90 * k, 1);
    // tapping the padlock says how far away the place still is
    if (pick) { s.userData.pick = pick; this.pickables.push(s); }
    return s;
  }

  private island(p: PlaceCfg, o: { fresh?: number; fade?: boolean; q?: boolean; S?: number; pick?: Pick | null; label?: string | null; lockK?: number; walk?: boolean; walkH?: number; lockPick?: Pick }) {
    const G = new THREE.Group(), ig = this.islandGeo(p.shape), st = p.status, t0 = now();
    // the place in progress fills in with its colour, a little more with every pair (the newest bit after its pair has risen)
    const T = p.total || PAIRS, stage = st === 'done' ? 4 : st === 'current' ? stageOf(p.pairs.length, T) : 0;
    // the newest pair builds the stages after the one before it (a place with fewer pairs builds more than one at a time)
    const isFresh = st === 'current' && o.fresh != null && o.fresh >= 0 && o.fresh < T;
    const fresh = isFresh ? stageOf(o.fresh! + 1, T) : -1, freshFrom = isFresh ? stageOf(o.fresh!, T) : -1;
    let top: THREE.Material, side: THREE.Material, line: THREE.Material | null = null;
    if (st === 'done') {
      top = this.toon(p.color); side = this.toon(shade(p.color));
      // the reveal: the place is already built and coloured in; its ink outline draws itself
      if (o.fade) { line = this.own(new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0 })); this.tweens.push({ m: [line], t0, dur: this.reducedMotion ? 0.6 : 2.6 }); }
      else line = this.basic(INK);
    } else if (st === 'current') {
      const tm = this.own(new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: this.grad, transparent: true })), sm = this.own(new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: this.grad, transparent: true }));
      const full = new THREE.Color(p.color), fullSide = new THREE.Color(shade(p.color)), f = stage / 4, f0 = fresh > 0 ? freshFrom / 4 : f;
      const paint = (k: number) => { tm.color.set('#ffffff').lerp(full, k); tm.opacity = 0.42 + 0.58 * k; sm.color.set('#ffffff').lerp(fullSide, k); sm.opacity = 0.2 + 0.8 * k; };
      paint(f0);
      if (f0 !== f) this.fx.push(n => { const k = this.reducedMotion ? 1 : clamp((n - t0 - 2.2) / 1.8, 0, 1); paint(f0 + (f - f0) * k); return k < 1; });
      top = tm; side = sm;
    } else { top = this.toon('#EEE7D8', 0.7); side = this.toon('#D8CFBC', 0.55); }
    const mesh = new THREE.Mesh(ig.geo, [top, side]); G.add(mesh);
    if (line) { G.add(new THREE.Mesh(ig.top, line)); G.add(new THREE.Mesh(ig.bot, line)); }
    if (st !== 'done' || o.fade) { const dm = this.basic(st === 'locked' ? '#B5AA94' : INK); ig.dashes.forEach((d: THREE.BufferGeometry) => G.add(new THREE.Mesh(d, dm))); }
    const slots = p.pairs.length <= SLOTS4.length ? SLOTS4 : SLOTS, spots = this.spots(ig.poly, slots, hashSeed(p.shape + p.theme));
    const beds = stage ? this.scenery(p.theme, G, ig.poly, spots, stage, fresh, t0, freshFrom) : [];
    // they walk on the place in progress too; there they just stroll, on a finished garden they smell the flowers
    if (st !== 'locked' && o.walk) this.islandWalkers(st === 'done' ? p.theme : '', G, o.walkH || 100, ig.poly, beds);
    if (o.pick) { mesh.userData.pick = o.pick; this.pickables.push(mesh); }
    if (st !== 'locked') p.pairs.forEach((pr, j) => {
      const slot = slots[j % slots.length]; if (!slot) return; const [u, v] = slot;
      // one shared drawing (a collaborative task) stands in the middle of its spot, a little bigger
      const one = !pr[1];
      ([[pr[0], one ? 0 : -32, one ? 5 : 0], [pr[1], 32, 10]] as const).forEach(([d, du, dv], side) => {
        if (!d) return;
        const rise = o.fresh === j ? t0 + (side ? 1.2 : 0.35) : 0;
        const b = this.drawing(d, (o.S || 72) * (one ? 1.25 : 1), rise); b.position.set(u - 240 + du, 3, v - 140 + dv); G.add(b);
      });
    });
    if (st === 'current' && o.q) { const q = this.sprite('?', { size: 150, color: '#8E7FD0' }); q.position.set(0, 150, 0); G.add(q); this.qs.push(q); this.huds.push(q); }
    if (st === 'locked') { const l = this.lockSprite(o.lockK || 1.4, o.lockPick); l.position.set(0, 70, 0); G.add(l); }
    if (o.label) { const s = this.sprite(o.label, { size: 46, pill: true, bg: st === 'done' ? INK : '#FFF3D1', color: st === 'done' ? '#FFF3D1' : INK, k: 1.25 }); s.position.set(0, 215, -60); s.material.depthTest = false; s.renderOrder = 999; G.add(s); this.huds.push(s); }
    return G;
  }

  /** Spots on an island for scenery: inside it, away from its edge and from where every pair stands (or will stand). */
  private spots(poly: number[][], slots: number[][], seed: number) {
    const taken = slots.flatMap(([u, v]) => [[u - 272, v - 140], [u - 208, v - 130]]), out: { x: number; z: number }[] = [];
    for (let z = -120; z <= 120; z += 30) for (let x = -230; x <= 230; x += 30) {
      if ([[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dz]) => inRing(poly, x + dx, z + dz)) && taken.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 46)) out.push({ x, z });
    }
    const R = rnd(seed); return out.map(s => ({ s, k: R() })).sort((a, b) => a.k - b.k).map(o => o.s);
  }

  private growIn(o: THREE.Object3D, at: number) { if (this.reducedMotion) return; this.grows.push({ o, s: o.scale.clone(), at }); o.scale.setScalar(0.0001); }

  /**
   * The place's scenery, built up one stage per pair (a finished place has all of them); the newest stage grows in
   * once its pair has risen. The river: a dry riverbed, then water, then it starts to flow, then lily pads and a bridge.
   * Returns the flower beds (the walkers smell the flowers there).
   */
  private scenery(theme: string, G: THREE.Group, poly: number[][], spots: { x: number; z: number }[], stage: number, fresh: number, t0: number, freshFrom = fresh - 1) {
    const K = this.kit ||= (() => {
      const flow = new THREE.CapsuleGeometry(1.8, 10, 3, 6); flow.rotateX(Math.PI / 2);
      return { box: new THREE.BoxGeometry(1, 1, 1), ball: new THREE.IcosahedronGeometry(1, 1), cone: new THREE.ConeGeometry(1, 1, 7), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), disc: new THREE.CircleGeometry(1, 24), flow } as Record<string, THREE.BufferGeometry>;
    })();
    let order = 0;
    const show = (s: number, o: THREE.Object3D) => { if (s > stage) return null; G.add(o); if (s > freshFrom && s <= fresh) this.growIn(o, t0 + 2.4 + order++ * 0.07); return o; };
    const put = (s: number, g: string, color: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, glow = false) => {
      if (s > stage) return null; const o = new THREE.Mesh(K[g], glow ? this.basic(color) : this.toon(color)); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return show(s, o) as THREE.Mesh;
    };
    const flat = (o: THREE.Mesh | null) => { if (o) o.rotation.x = -Math.PI / 2; return o; };
    const plant = (o: THREE.Mesh | null) => { if (o) { o.userData.plant = { pop: 0, base: o.scale.clone() }; this.plants.push(o); } return o; };
    const COLS = ['#F26A2E', '#E9A3C0', '#8FD6D0', '#FFC93C', '#9BD770'], R = rnd(hashSeed(theme) + spots.length);
    const at = (i: number) => spots[i % Math.max(1, spots.length)];
    if (!spots.length) return [];

    if (theme === 'river') {
      const zAt = (x: number) => 12 + Math.sin(x / 45) * 12, pts: THREE.Vector3[] = [];
      for (let x = -240; x <= 240; x += 12) if (inRing(poly, x - 14, zAt(x)) && inRing(poly, x + 14, zAt(x))) pts.push(new THREE.Vector3(x, 0, zAt(x)));
      if (pts.length < 4) return [];
      const curve = new THREE.CatmullRomCurve3(pts), side = (u: number, d: number) => { const q = curve.getPointAt(u), tg = curve.getTangentAt(u); return [q.x - tg.z * d, q.z + tg.x * d]; };
      const ribbon = (s: number, r: number, color: string, y: number) => { if (s > stage) return; const o = new THREE.Mesh(this.own(new THREE.TubeGeometry(curve, 90, r, 8, false)), this.toon(color)); o.position.y = y; o.scale.y = 0.08; show(s, o); };
      // 1: the riverbed, dry, with pebbles along its banks
      ribbon(1, 27, '#E3CFA0', 1.2);
      for (let i = 0; i < 16; i++) { const [x, z] = side((i + 0.5) / 16, i % 2 ? 30 : -30); put(1, 'ball', '#B9AE9A', x, 2, z, 3.4, 2.2, 3.4); }
      // 2: water fills it
      ribbon(2, 22, '#3E8FDB', 1.9);
      // 3: it starts to flow (slowly at first) and reeds grow on the banks; 4: it flows properly, with lily pads and a little bridge
      if (stage >= 3) for (let i = 0; i < 12; i++) { const f = new THREE.Mesh(K.flow, this.basic('#ffffff')); G.add(f); this.streams.push({ o: f, curve, i, n: 12, speed: stage >= 4 ? 1 : 0.4, from: freshFrom < 3 && fresh >= 3 ? t0 + 3 : 0 }); }
      for (let i = 0; i < 10; i++) { const [x, z] = side((i + 0.3) / 10, (i % 2 ? 1 : -1) * (34 + R() * 6)); [-3, 0, 3].forEach((d, k) => put(3, 'cone', k === 1 ? '#3E9B48' : '#6CC24A', x + d, 8 + k * 2, z + d * 0.6, 1.6, 16 + k * 4, 1.6)); }
      [0.18, 0.36, 0.7, 0.86].forEach((u, i) => { const [x, z] = side(u, i % 2 ? 10 : -10); flat(put(4, 'disc', '#6CC24A', x, 4.2, z, 6)); put(4, 'ball', '#E9A3C0', x, 5.4, z, 2); });
      const q = curve.getPointAt(0.5), tg = curve.getTangentAt(0.5), bridge = new THREE.Group(), wood = this.toon('#B5793F');
      bridge.position.set(q.x, 0, q.z); bridge.rotation.y = Math.atan2(tg.x, tg.z) + Math.PI / 2;
      const deck = new THREE.Mesh(K.box, wood); deck.scale.set(16, 3, 70); deck.position.y = 7; bridge.add(deck);
      [-7, 7].forEach(dx => { const rail = new THREE.Mesh(K.box, wood); rail.scale.set(1.6, 6, 70); rail.position.set(dx, 12, 0); bridge.add(rail); });
      show(4, bridge);
      return [];
    }
    if (theme === 'garden') {
      const beds = [0, 1, 2, 3, 4].map(at), FL = ['#F26A2E', '#E9A3C0', '#FFC93C', '#ffffff', '#8E7FD0'];
      // 1: flower beds dug, 2: sprouts, 3: trees and hedges, 4: the flowers bloom
      beds.forEach((b, i) => {
        flat(put(1, 'disc', '#8A5A3B', b.x, 1.4, b.z, 17));
        [[-7, -4], [6, -5], [0, 7]].forEach(([dx, dz], k) => {
          if (stage < 4) put(2, 'cone', '#6CC24A', b.x + dx, 5, b.z + dz, 2.6, 9, 2.6);
          put(4, 'cyl', '#4E9F3D', b.x + dx, 7, b.z + dz, 0.9, 13, 0.9); plant(put(4, 'ball', FL[(i + k) % FL.length], b.x + dx, 15, b.z + dz, 4.6));
        });
      });
      [5, 6, 7, 8].map(at).forEach((t, i) => { put(3, 'cyl', '#8A5A3B', t.x, 11, t.z, 3.5, 22, 3.5); put(3, 'ball', ['#4FAE3E', '#6CC24A', '#3E9B48'][i % 3], t.x, 34, t.z, 17); });
      [9, 10, 11].map(at).forEach(h => put(3, 'ball', '#3E9B48', h.x, 8, h.z, 13, 9, 13));
      return beds;
    }
    if (theme === 'market') {
      // 1: the stalls' posts go up, 2: awnings and counters, 3: goods and crates, 4: flags and lanterns
      [0, 1, 2, 3].map(at).forEach((s, i) => {
        [[-12, -9], [12, -9], [-12, 9], [12, 9]].forEach(([dx, dz]) => put(1, 'cyl', '#8A5A3B', s.x + dx, 14, s.z + dz, 1.6, 28, 1.6));
        put(2, 'box', COLS[i % 5], s.x, 30, s.z, 32, 4, 26); put(2, 'box', '#C99A6B', s.x, 6, s.z + 4, 26, 12, 10);
        [-8, 0, 8].forEach((dx, k) => put(3, 'ball', COLS[(i + k + 1) % 5], s.x + dx, 15, s.z + 4, 3.6));
        put(4, 'cyl', '#8A5A3B', s.x, 41, s.z, 0.8, 18, 0.8); put(4, 'box', COLS[(i + 2) % 5], s.x + 6, 47, s.z, 11, 7, 1);
        [[-14, 10], [14, 10]].forEach(([dx, dz]) => put(4, 'ball', '#FFC93C', s.x + dx, 24, s.z + dz, 2.6, 2.6, 2.6, true));
      });
      [4, 5, 6, 7].map(at).forEach((c, i) => { const b = put(3, 'box', '#B5793F', c.x, 6, c.z, 12, 12, 12); if (b) b.rotation.y = i * 0.7; put(3, 'ball', COLS[i % 5], c.x, 14, c.z, 4); });
      return [];
    }
    if (theme === 'rooftop') {
      // 1: roof tiles and chimneys, 2: a water tank and pots, 3: a washing line and a kite, 4: fairy lights and stars
      [0, 1, 2].map(at).forEach((r, i) => { const t = put(1, 'box', '#C8573E', r.x, 2.5, r.z, 36, 4, 26); if (t) t.rotation.y = (i - 1) * 0.3; put(1, 'box', '#A6452F', r.x + 10, 13, r.z - 6, 7, 18, 7); });
      const tk = at(3); [[-7, -7], [7, -7], [-7, 7], [7, 7]].forEach(([dx, dz]) => put(2, 'cyl', '#8A5A3B', tk.x + dx, 8, tk.z + dz, 1.2, 16, 1.2)); put(2, 'cyl', '#8FA8B8', tk.x, 24, tk.z, 11, 16, 11);
      [4, 5, 6].map(at).forEach(pt => { put(2, 'cyl', '#C8573E', pt.x, 4, pt.z, 5, 8, 5); put(2, 'ball', '#4FAE3E', pt.x, 11, pt.z, 6); });
      const wl = at(7);
      [-24, 24].forEach(dx => put(3, 'cyl', '#8A5A3B', wl.x + dx, 16, wl.z, 1.2, 32, 1.2)); put(3, 'box', INK, wl.x, 31, wl.z, 48, 0.8, 0.8);
      [-14, -2, 10].forEach((dx, k) => put(3, 'box', COLS[k], wl.x + dx, 25, wl.z, 9, 11, 1));
      [-18, -6, 6, 18].forEach(dx => put(4, 'ball', '#FFE27A', wl.x + dx, 30, wl.z, 2.2, 2.2, 2.2, true));
      if (stage >= 3) {
        const kp = at(8), kite = new THREE.Group(); kite.position.set(kp.x, 0, kp.z);
        const str = new THREE.Mesh(K.cyl, this.basic(INK)); str.scale.set(0.4, 110, 0.4); str.position.y = 55; kite.add(str);
        const k = new THREE.Mesh(K.box, this.toon('#F26A2E')); k.scale.set(16, 16, 1.5); k.rotation.z = Math.PI / 4; k.position.y = 112; kite.add(k);
        show(3, kite); this.loops.push(t => { kite.rotation.z = Math.sin(t * 0.9) * 0.12; kite.rotation.x = Math.sin(t * 0.7 + 1) * 0.08; });
      }
      for (let i = 0; i < 6; i++) { const s = at(9 + i); put(4, 'ball', '#FFE27A', s.x, 120 + R() * 70, s.z, 3, 3, 3, true); }
      return [];
    }
    return [];
  }

  private month(places: PlaceCfg[], o: { pick?: boolean; labels?: boolean; lite?: boolean; kind?: string; mi?: number } = {}) {
    const G = new THREE.Group(), alive = places.length > 0 && places.every(p => p.status === 'done');
    // a map of one place (the Welcome Party) is that place itself: it fills the whole map, not one corner of a land
    if (places.length === 1) {
      const p = places[0], lbl = o.labels !== false && p.status === 'current' ? 'This week · ' + Math.max(0, (p.total || PAIRS) - p.pairs.length) + ' to go' : null;
      const g = this.island(p, { label: lbl, q: true, pick: o.pick && p.status !== 'locked' ? { type: 'place', pi: 0 } : null, lockPick: { type: 'lock', mi: o.mi, pi: 0 }, lockK: 1.6, walk: !!o.pick, walkH: 100, S: 76 });
      g.scale.setScalar(2.6); G.add(g); G.userData.alive = false; return G;
    }
    // while the map is in progress the two of them stroll on this week's place (or a finished one), and across the whole land once it is finished
    const cur = places.findIndex(p => p.status === 'current'), walkI = o.pick && !alive ? (cur >= 0 ? cur : places.findIndex(p => p.status === 'done')) : -1;
    places.forEach((p, i) => {
      const lbl = p.status === 'done' ? p.name : p.status === 'current' ? 'This week · ' + Math.max(0, (p.total || PAIRS) - p.pairs.length) + ' to go' : null;
      const g = this.island(p, { label: o.labels !== false ? lbl : null, q: true, pick: o.pick && p.status !== 'locked' ? { type: 'place', pi: i } : null, lockPick: { type: 'lock', mi: o.mi, pi: i }, lockK: 1.6, walk: i === walkI, walkH: 80 });
      g.position.set(MPOS[i][0], 0, MPOS[i][1]); G.add(g);
    });
    if (alive) { this.land(G, o.lite, o.kind); if (o.pick) this.mapWalkers(o.kind || '', G, 74); }
    const pts = [[-760, -420], ...MPOS, [760, 520]].map(([x, z]) => new THREE.Vector3(x, alive ? -19 : -10, z));
    const curve = new THREE.CatmullRomCurve3(pts), n = Math.round(curve.getLength() / 34), dm = this.toon('#FFC93C');
    curve.getSpacedPoints(n).forEach(pt => { if (alive && !onLand(pt.x, pt.z)) return; const s = new THREE.Mesh(this.dot ||= new THREE.SphereGeometry(7, 10, 8), dm); s.position.copy(pt); G.add(s); });
    G.userData.alive = alive; return G;
  }

  private edge(pts: THREE.Vector3[], r: number) { const cp = new THREE.CurvePath<THREE.Vector3>(); for (let i = 0; i < pts.length; i++) cp.add(new THREE.LineCurve3(pts[i], pts[(i + 1) % pts.length])); return new THREE.TubeGeometry(cp as any, pts.length * 6, r, 5, false); }

  /** The land a finished map stands on (lite: the small copy in the stack, without sea, clouds and compass). */
  private land(G: THREE.Group, lite = false, kind = '') {
    const palms = /seaside|beach|desert|island/i.test(kind);
    const c = this.landGeo ||= (() => {
      const sh = new THREE.Shape(); LAND.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath();
      const land = new THREE.ExtrudeGeometry(sh, { depth: 44, bevelEnabled: true, bevelThickness: 4, bevelSize: 6, bevelSegments: 1 }); land.rotateX(Math.PI / 2); land.translate(0, -30, 0);
      const river = new THREE.CatmullRomCurve3(RIV.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const flow = new THREE.CapsuleGeometry(2.6, 16, 3, 6); flow.rotateX(Math.PI / 2);
      const ring = new THREE.TorusGeometry(1, 0.05, 6, 48); ring.rotateX(Math.PI / 2);
      return {
        land, top: this.edge(LAND.map(([x, z]) => new THREE.Vector3(x, -25.4, z)), 2.4), bot: this.edge(LAND.map(([x, z]) => new THREE.Vector3(x, -78, z)), 2),
        river, riverGeo: new THREE.TubeGeometry(river, 120, 26, 8, false), flow, ring,
        puff: new THREE.IcosahedronGeometry(1, 1), disc: new THREE.CircleGeometry(1, 24),
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
    let placed = 0, tries = 0;
    while (placed < (lite ? 30 : 48) && tries < 3000) {
      tries++; const x = -780 + R() * 1560, z = -510 + R() * 1090; if (!clear(x, z, 12)) continue; placed++;
      // the hand-drawn trees: pines up by the hills, bushy ones in the west, palms by the sea, leafy ones elsewhere
      const name = (x > 380 && z < -150) || R() < 0.2 ? 'tree-pine' : x < -420 ? 'tree-bushy' : palms && R() < 0.7 ? 'tree-palms' : 'tree-leafy';
      const t = this.pic(name, (name === 'tree-palms' ? 92 : 70) * (0.8 + R() * 0.45)); t.position.set(x, -26, z); G.add(t);
    }
    // a few rocks in the grass
    let rocks = 0; tries = 0;
    while (rocks < (lite ? 3 : 6) && tries < 2000) {
      tries++; const x = -760 + R() * 1520, z = -500 + R() * 1060; if (!clear(x, z, 26)) continue; rocks++;
      const r = this.pic(rocks % 2 ? 'rocks-pair' : 'rock-tall', 26 + R() * 10); r.position.set(x, -26, z); G.add(r);
    }
    let flock = 0; tries = 0;
    while (flock < 5 && tries < 2000) {
      tries++; const x = -700 + R() * 1400, z = -480 + R() * 1000; if (!clear(x, z, 30)) continue; flock++;
      const s = new THREE.Group(), body = new THREE.Mesh(c.puff, this.toon('#ffffff')), hd = new THREE.Mesh(c.puff, this.toon(INK));
      body.scale.set(13, 10, 10); body.position.y = 12; hd.scale.setScalar(5.5); hd.position.set(13, 15, 0); s.add(body, hd); s.position.set(x, -26, z); G.add(s);
      this.sheep.push({ o: s, cx: x, cz: z, ph: R() * 6 });
    }
    if (lite) return;
    // the dog trots about by the river; the cat naps by the pond (tap them while walking around)
    const dog = this.pic('dog', 34); dog.userData.say = 'Woof woof!'; const dg = new THREE.Group(); dg.add(dog); G.add(dg);
    this.sheep.push({ o: dg, cx: 110, cz: 260, ph: 1.3 }); this.pets.push(dog);
    const cat = this.pic('cat', 26); cat.userData.say = 'Purrr…'; cat.position.set(POND[0] - POND[2] - 36, -26, POND[1] + 44); G.add(cat); this.pets.push(cat);
    const sea = new THREE.Mesh(c.disc, this.toon('#7FD0C9')); sea.rotation.x = -Math.PI / 2; sea.scale.setScalar(3200); sea.position.y = -82; G.add(sea);
    for (let i = 0; i < 4; i++) {
      const cl = new THREE.Group(); [[0, 0, 30], [30, 6, 24], [-28, 2, 22], [10, 16, 22]].forEach(([dx, dy, r]) => { const p = new THREE.Mesh(c.puff, this.toon('#ffffff')); p.scale.setScalar(r); p.position.set(dx, dy, 0); cl.add(p); });
      const x0 = -900 + i * 470; cl.position.set(x0, 250 + (i % 2) * 50, -360 + i * 240); G.add(cl); this.clouds.push({ o: cl, x0, v: 12 + i * 3 });
    }
    // birds flying over (they drift with the clouds; the pair is drawn facing left, so it is turned round)
    ([['birds-pair', 60, 190, -120, 26], ['bird-green', 34, 160, 260, 34]] as const).forEach(([name, h, y, z, v], i) => {
      const b = this.pic(name, h); if (name === 'birds-pair') b.scale.x *= -1; const g = new THREE.Group(); g.add(b);
      const x0 = -600 + i * 700; g.position.set(x0, y, z); G.add(g); this.clouds.push({ o: g, x0, v });
    });
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

  /** A hand-drawn picture standing in the scene, always facing the camera; h = height of the drawing itself. */
  private pic(name: string, h: number) {
    const P = PIC[name], url = import.meta.env.BASE_URL + 'scenery/' + name + '.png';
    let tex = this.faceTex.get(url);
    if (!tex) { tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace; this.faceTex.set(url, tex); }
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.04 })));
    const H = h / P.vis; s.center.set(P.cx, P.cy); s.scale.set(H * P.a, H, 1); s.renderOrder = 4; s.userData.w = H * P.a; return s;
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
  private islandWalkers(theme: string, G: THREE.Group, h: number, poly: number[][], beds: { x: number; z: number }[] = []) {
    if (!this.cfg?.walkers) return;
    const P = (x: number, z: number, p: number, act: Stop['act'], f?: 1 | -1): Stop => ({ x, z, p, act, f });
    // walking around, they keep a step away from the island's edge
    const m = 22, ground: Ground = (x, z) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dz]) => inRing(poly, x + dx, z + dz)) ? 0 : null;
    if (theme === 'garden' && beds.length > 1) {
      // round the flower beds (scenery()), stopping beside each one to smell the flowers
      const F = [...beds].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)).map(b => ground(b.x + 24, b.z) != null ? P(b.x + 24, b.z, 2.4, 'sniff', -1) : P(b.x - 24, b.z, 2.4, 'sniff', 1));
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

  // ---- the Dream House: rooms built up prompt by prompt, then the house rebuilt from their drawing of it ----
  private tex(url: string) {
    let t = this.faceTex.get(url);
    if (!t) { t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.faceTex.set(url, t); }
    return t;
  }
  /** A piece of hand-drawn furniture or park scenery, standing up (or lying flat, like the rug). */
  private standee(k: string, h: number, flat = false) {
    const [w, hh] = DRW[k], url = import.meta.env.BASE_URL + 'dream/' + k + (k === 'play' ? '.png' : '.svg'), W = flat ? h : (h * w) / hh, H = flat ? (h * hh) / w : h;
    const g = this.own(new THREE.PlaneGeometry(W, H)); if (!flat) g.translate(0, H / 2, 0);
    const m = new THREE.Mesh(g, this.own(new THREE.MeshBasicMaterial({ map: this.tex(url), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide })));
    if (flat) m.rotation.x = -Math.PI / 2; const G = new THREE.Group(); G.add(m); return G;
  }
  private floorTex(kind: string) {
    const key = 'floor:' + kind; let t = this.faceTex.get(key); if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
    if (kind === 'tile') { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#F6EBD6' : '#E3CFAE'; x.fillRect(i * 32, j * 32, 32, 32); } }
    else { x.fillStyle = '#E9C79A'; x.fillRect(0, 0, 256, 256); x.strokeStyle = '#C99E6A'; x.lineWidth = 3; for (let j = 0; j < 8; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(256, j * 32); x.stroke(); const o = (j % 2) * 64; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(o + i * 128, j * 32); x.lineTo(o + i * 128, j * 32 + 32); x.stroke(); } } }
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); this.faceTex.set(key, t); return t;
  }
  private seg(a: number[], b: number[], r: number, col = INK) { return new THREE.Mesh(this.own(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])), 1, r, 5, false)), this.basic(col)); }
  /** A hand-drawn creature, grass or tree (public/nature), always facing the camera. */
  private npic(k: string, h: number, cy = 0) {
    const [w, hh] = NAT[k], s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: this.tex(import.meta.env.BASE_URL + 'nature/' + k + '.png'), transparent: true, alphaTest: 0.12 })));
    s.center.set(0.5, cy); const sw = (h * w) / hh; s.scale.set(sw, h, 1); s.userData.w = sw; return s;
  }
  private flyer(G: THREE.Group, k: string, x: number, z: number, y: number, o: { size?: number; ph?: number; r?: number; at?: number }) { const s = this.npic(k, o.size || 22, 0.5); G.add(s); this.critters.push({ s, kind: 'fly', cx: x, cz: z, y0: y, ph: o.ph || 0, r: o.r || 30, flap: k.startsWith('bfly'), at: o.at || 0 }); }
  private fishAt(G: THREE.Group, k: string, x: number, z: number, y: number, dx: number, dz: number, o: { size?: number; span?: number; H?: number; ph?: number; per?: number }) {
    const s = this.npic(k, o.size || 20, 0.5), L = Math.hypot(dx, dz) || 1; s.visible = false; G.add(s);
    this.critters.push({ s, kind: 'fish', x0: x, z0: z, y0: y, dx: dx / L, dz: dz / L, span: o.span || 40, H: o.H || 32, ph: o.ph || 0, per: o.per || 4, face: FACE[k] || 1, at: 0 });
  }

  /** The house from their drawing: the drawing is its front, walls and roof take its colours, the door swings open. */
  private buildHouse(HG: THREE.Group, d: HouseShape, cfg: DreamMapCfg, fr: boolean) {
    const k = (HX1 - HX0) / Math.max(1, d.br - d.bl), X = (px: number) => HX0 + (px - d.bl) * k, Y = (py: number) => (d.bodyB - py) * k;
    const wallH = Math.max(60, Y(d.eaveY)), ridgeH = Math.max(wallH + 30, Y(d.apexY)), eL = X(d.el), eR = X(d.er), aX = X(d.mid);
    const tx = (c: HTMLCanvasElement) => { const t = this.own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const plane = (c: HTMLCanvasElement, w: number, h: number) => new THREE.Mesh(this.own(new THREE.PlaneGeometry(w, h)), this.own(new THREE.MeshBasicMaterial({ map: tx(c), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })));
    const fw = d.W * k, fh = d.H * k, cx = X(d.W / 2), cy = Y(d.H / 2);
    const front = new THREE.Group(); front.position.set(0, 0, HZ1); const fm = plane(d.fc, fw, fh); fm.position.set(cx, cy, 0); front.add(fm); HG.add(front);
    const walls = new THREE.Group(); HG.add(walls);
    const back = plane(d.src, fw, fh); back.position.set(cx, cy, HZ0 - 1); back.rotation.y = Math.PI; walls.add(back);
    const wm = this.toon(d.wall), wm2 = this.toon(shade(d.wall, 0.92)), lm = this.own(new THREE.LineBasicMaterial({ color: INK }));
    const box = (w: number, h: number, dd: number, x: number, y: number, z: number, m: THREE.Material) => {
      const g = this.own(new THREE.BoxGeometry(w, h, dd)), b = new THREE.Mesh(g, m); b.position.set(x, y, z); walls.add(b);
      const ed = new THREE.LineSegments(this.own(new THREE.EdgesGeometry(g)), lm); ed.position.copy(b.position); walls.add(ed);
    };
    box(10, wallH, HZ1 - HZ0, HX0, wallH / 2, (HZ0 + HZ1) / 2, wm); box(10, wallH, HZ1 - HZ0, HX1, wallH / 2, (HZ0 + HZ1) / 2, wm); box(HX1 - HX0, wallH, 4, 0, wallH / 2, HZ0 + 2, wm2);
    // the wall between the living room and the kitchen, with a doorway in the middle
    const ph = wallH * 0.9; box(8, ph, 120, 0, ph / 2, -270, wm2); box(8, ph, 120, 0, ph / 2, -50, wm2);
    const roof = new THREE.Group(); HG.add(roof);
    const rm = this.own(new THREE.MeshToonMaterial({ color: d.roof, gradientMap: this.grad, side: THREE.DoubleSide })), za = HZ0 - 16, zb = HZ1 + 16;
    const quad = (a: number[], b: number[], c: number[], f: number[]) => { const g = this.own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...f], 3)); g.computeVertexNormals(); return new THREE.Mesh(g, rm); };
    roof.add(quad([eL, wallH, za], [aX, ridgeH, za], [aX, ridgeH, zb], [eL, wallH, zb]), quad([eR, wallH, za], [eR, wallH, zb], [aX, ridgeH, zb], [aX, ridgeH, za]));
    ([[[eL, wallH, za], [aX, ridgeH, za]], [[eR, wallH, za], [aX, ridgeH, za]], [[aX, ridgeH, za], [aX, ridgeH, zb]], [[eL, wallH, za], [eL, wallH, zb]], [[eR, wallH, za], [eR, wallH, zb]]] as number[][][]).forEach(([a, b]) => roof.add(this.seg(a, b, 2.4)));
    let D: DoorState | null = null;
    if (d.door && d.dc) {
      const [a, b, c2, e2] = d.door, dw = (c2 - a) * k, dh = (e2 - b) * k, dx = X(a), dy = Y(e2), piv = new THREE.Group(); piv.position.set(dx, dy, 1);
      const dm = plane(d.dc, dw, dh); dm.position.set(dw / 2, dh / 2, 0); piv.add(dm); front.add(piv);
      const hl = new THREE.Group();
      ([[[dx, dy, 3], [dx + dw, dy, 3]], [[dx + dw, dy, 3], [dx + dw, dy + dh, 3]], [[dx + dw, dy + dh, 3], [dx, dy + dh, 3]], [[dx, dy + dh, 3], [dx, dy, 3]]] as number[][][]).forEach(([p, q]) => hl.add(this.seg(p, q, 5, '#FFE66D')));
      hl.visible = false; front.add(hl);
      const tag = this.sprite('Door found!', { size: 44, pill: true, bg: '#FFC93C', color: INK, k: 0.55 }); tag.position.set(dx + dw / 2, dy + dh + 50, 8); tag.visible = false; front.add(tag);
      D = this.door = { piv, x0: dx, x1: dx + dw, cx: dx + dw / 2, open: 0, forced: null, hl, tag };
      // the walkers go in and out through it
      this.walkers.forEach(w => w.legs.forEach(l => { if (l.a.door) l.a.x = D!.cx; if (l.b.door) l.b.x = D!.cx; }));
    }
    // look inside: the roof lifts off and the front comes away
    if (cfg.peek) { roof.visible = false; front.visible = false; back.visible = false; }
    if (fr && !this.reducedMotion) {
      // the front rises up off the ground, the walls grow, the roof drops on, the door is found and swings open once
      const t0 = now() + 0.5; front.rotation.x = Math.PI / 2; walls.scale.y = 0.0001; roof.position.y = 700;
      this.fx.push(n => {
        const c = (v: number) => clamp(v, 0, 1), k1 = c((n - t0) / 1.5), k2 = c((n - t0 - 1.3) / 0.8), k3 = c((n - t0 - 2) / 0.9);
        front.rotation.x = (Math.PI / 2) * (1 - easeBack(k1)); walls.scale.y = Math.max(0.0001, easeBack(k2)); roof.position.y = 700 * (1 - k3) * (1 - k3);
        if (D) { const on = n > t0 + 3 && n < t0 + 6.4; D.hl.visible = on && Math.floor(n * 4) % 2 === 0; D.tag.visible = on; D.forced = n > t0 + 4 && n < t0 + 5.8 ? 1 : null; }
        return n < t0 + 6.5;
      });
    }
    let last = now();
    if (D) this.fx.push(n => {
      const dt = Math.min(0.05, n - last); last = n; if (!D!.piv.parent) return false;
      // walking up to the door opens it
      let tg = D!.forced != null ? D!.forced : 0; if (this.pov) tg = Math.hypot(this.pov.x - D!.cx, this.pov.z - HZ1) < 170 ? 1 : 0;
      D!.open += (tg - D!.open) * Math.min(1, dt * 4); D!.piv.rotation.y = -D!.open * 1.75; return true;
    });
  }

  private dream(cfg: DreamMapCfg, o: { lite?: boolean; mi?: number } = {}) {
    const G = new THREE.Group(), R = rnd(5), rooms = cfg.dream.rooms, hs = cfg.dream.house, fr = cfg.fresh || null, lite = !!o.lite, t0 = now();
    const dot = this.dot ||= new THREE.SphereGeometry(7, 10, 8), disc = this.disc ||= new THREE.CircleGeometry(1, 24);
    const grow = (s: THREE.Object3D, d = 0.4) => this.growIn(s, t0 + d + R() * 0.6);
    // the ground: a rounded green board
    const sh = new THREE.Shape(), x0 = -620, x1 = 620, z0 = -380, z1 = 420, r = 80;
    sh.moveTo(x0 + r, z0); sh.lineTo(x1 - r, z0); sh.quadraticCurveTo(x1, z0, x1, z0 + r); sh.lineTo(x1, z1 - r); sh.quadraticCurveTo(x1, z1, x1 - r, z1); sh.lineTo(x0 + r, z1); sh.quadraticCurveTo(x0, z1, x0, z1 - r); sh.lineTo(x0, z0 + r); sh.quadraticCurveTo(x0, z0, x0 + r, z0);
    const gg = this.own(new THREE.ExtrudeGeometry(sh, { depth: 30, bevelEnabled: false, curveSegments: 8 })); gg.rotateX(Math.PI / 2);
    const pts = sh.getPoints(8);
    G.add(new THREE.Mesh(gg, [this.toon('#9BDB6A'), this.toon('#4E9F3D')]), new THREE.Mesh(this.own(this.edge(pts.map(p => new THREE.Vector3(p.x, 0.5, p.y)), 2.4)), this.basic(INK)), new THREE.Mesh(this.own(this.edge(pts.map(p => new THREE.Vector3(p.x, -30, p.y)), 2)), this.basic(INK)));
    const dash = (ax0: number, az0: number, ax1: number, az1: number, col: string) => { const dm = this.basic(col), per = [[ax0, az0], [ax1, az0], [ax1, az1], [ax0, az1]]; for (let i = 0; i < 4; i++) { const [ax, az] = per[i], [bx, bz] = per[(i + 1) % 4], n = Math.round(Math.hypot(bx - ax, bz - az) / 30); for (let j = 0; j < n; j++) { const s = new THREE.Mesh(dot, dm); s.scale.setScalar(0.55); s.position.set(ax + ((bx - ax) * j) / n, 3, az + ((bz - az) * j) / n); G.add(s); } } };
    const pn = rooms.park?.n || 0;
    (Object.keys(ROOMS) as RoomKey[]).forEach(key => {
      const def = ROOMS[key], rm = rooms[key], n = rm?.n || 0, st = rm?.status || 'locked', isF = (j: number) => !!fr && fr.room === key && fr.i === j;
      const rx0 = def.x - def.w / 2, rx1 = def.x + def.w / 2, rz0 = def.z - def.d / 2, rz1 = def.z + def.d / 2;
      if (n === 0) dash(rx0 + 10, rz0 + 10, rx1 - 10, rz1 - 10, st === 'locked' ? '#B5AA94' : INK);
      if (st === 'locked') { const l = this.lockSprite(1.4, { type: 'lock', mi: o.mi, room: key as RoomKey }); l.position.set(def.x, 70, def.z); G.add(l); return; }
      // an invisible pad over the room, so it can be tapped from above
      if (!lite) { const pad = new THREE.Mesh(this.own(new THREE.BoxGeometry(def.w, 6, def.d)), this.own(new THREE.MeshBasicMaterial({ visible: false }))); pad.position.set(def.x, 3, def.z); pad.userData.pick = { type: 'room', room: key }; G.add(pad); this.pickables.push(pad); }
      if (n === 0 && !(hs.status === 'current' && key !== 'park')) { const q = this.sprite('?', { size: 150, color: '#8E7FD0' }); q.position.set(def.x, 150, key === 'park' ? def.z + 110 : def.z); G.add(q); this.qs.push(q); this.huds.push(q); }
      if (n > 0 && def.floor) {
        const top = this.own(new THREE.MeshToonMaterial({ map: this.floorTex(def.floor), gradientMap: this.grad })), sd = this.toon('#C99E6A'), fg = this.own(new THREE.BoxGeometry(def.w - 8, 4, def.d - 8));
        const f = new THREE.Mesh(fg, [sd, sd, top, sd, sd, sd]); f.position.set(def.x, 2, def.z); G.add(f);
        const ed = new THREE.LineSegments(this.own(new THREE.EdgesGeometry(fg)), this.own(new THREE.LineBasicMaterial({ color: INK }))); ed.position.copy(f.position); G.add(ed);
        if (isF(0)) { grow(f, 0.1); grow(ed, 0.1); }
      }
      def.furn.forEach(([k, u, x, z, h, y = 0, flat]) => { if (n < u) return; const s = this.standee(k, h, !!flat); s.position.set(x, flat ? 4.5 : y + (def.floor ? 4 : 0), z); G.add(s); if (isF(u - 1)) grow(s, 0.3); });
      (rm?.pairs || []).forEach((pr, j) => {
        const sl = def.slots[j]; if (!sl) return;
        // one shared drawing (a collaborative task) stands between its two spots, a little bigger
        const one = !pr[1], mid: [number, number, number] = [(sl[0][0] + sl[1][0]) / 2, (sl[0][1] + sl[1][1]) / 2, Math.max(sl[0][2], sl[1][2])];
        ([[pr[0], one ? mid : sl[0]], [pr[1], sl[1]]] as const).forEach(([d, [x, z, y]], side) => {
          if (!d) return; const b = this.drawing(d, one ? 66 : 54, isF(j) ? t0 + 1.2 + side * 0.6 : 0); b.position.set(x, y + (def.floor ? 4 : 0), z); G.add(b);
        });
      });
    });
    // the park: trees and a pond, a path; then things flying about; then a bridge to a floating fantasy island
    if (pn >= 1) {
      const fP = !!fr && fr.room === 'park' && fr.i === 0;
      ([[-530, 120, 230, 0], [-470, 340, 200, 1], [520, 80, 210, 2], [-560, -200, 240, 3], [560, -250, 220, 1], [300, 380, 180, 0]] as const).forEach(([x, z, h, i]) => { const s = this.npic(TREES[i], h); s.position.set(x, 0, z); G.add(s); this.critters.push({ s, kind: 'sway', ph: R() * 6, amp: 0.03 }); if (fP) grow(s, 0.2); });
      const pm = new THREE.Mesh(disc, this.toon('#5AB0F0')); pm.rotation.x = -Math.PI / 2; pm.scale.setScalar(72); pm.position.set(380, 1, 300); G.add(pm);
      const rg = new THREE.Mesh(this.own(new THREE.TorusGeometry(72, 2.4, 6, 48)), this.basic(INK)); rg.rotation.x = Math.PI / 2; rg.position.set(380, 1.2, 300); G.add(rg); if (fP) { grow(pm, 0.2); grow(rg, 0.2); }
    }
    if (pn >= 3 && !lite) ['bfly1', 'bfly2', 'bee'].forEach((k, i) => this.flyer(G, k, -200 + i * 220, 240 - i * 30, 60, { size: 28, ph: i * 2, r: 50, at: fr && fr.room === 'park' && fr.i === 2 ? t0 + 1.5 : 0 }));
    // the pin at the edge of the finished map, until the bridge is built: walking to it unlocks the bridge's prompt
    if (cfg.dream.alive && !cfg.dream.bridged) this.pin(G, lite);
    if (cfg.dream.bridged) {
      const fP = !!fr && fr.room === 'bridge', B = new THREE.Group(), wood = this.toon('#C98B5A'), rail: THREE.Vector3[][] = [[], []];
      const plank = this.own(new THREE.BoxGeometry(15, 4, 64)), post = this.own(new THREE.BoxGeometry(3, 30, 3));
      for (let i = 0; i < 14; i++) {
        const u = i / 13, x = 600 + u * 230, y = Math.sin(Math.PI * u) * 40 + u * 92, p = new THREE.Mesh(plank, wood); p.position.set(x, y, 220); B.add(p);
        rail[0].push(new THREE.Vector3(x, y + 30, 190)); rail[1].push(new THREE.Vector3(x, y + 30, 250));
        if (i % 3 === 0) [190, 250].forEach(z => { const q = new THREE.Mesh(post, this.basic(INK)); q.position.set(x, y + 15, z); B.add(q); });
      }
      rail.forEach(rr => B.add(new THREE.Mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rr), 40, 2, 5, false)), this.basic(INK)))); G.add(B);
      const I = new THREE.Group(); I.position.set(960, 0, 220);
      const top = new THREE.Mesh(this.own(new THREE.CylinderGeometry(150, 40, 90, 12)), [this.toon('#C9B6F2'), this.toon('#F5D3F0'), this.toon('#8E7FD0')]); top.position.y = 47; I.add(top);
      const rim = new THREE.Mesh(this.own(new THREE.TorusGeometry(150, 2.4, 6, 48)), this.basic(INK)); rim.rotation.x = Math.PI / 2; rim.position.y = 92; I.add(rim);
      ['#E4572E', '#FFC93C', '#6CC24A', '#2F5FD0', '#9B5DE5'].forEach((c, i) => { const a = new THREE.Mesh(this.own(new THREE.TorusGeometry(120 - i * 12, 6, 8, 40, Math.PI)), this.toon(c)); a.position.set(0, 92, -60); I.add(a); });
      const ico = this.own(new THREE.IcosahedronGeometry(1, 0)), sp: THREE.Mesh[] = [];
      for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(ico, this.basic('#FFE66D')); s.scale.setScalar(6); s.position.set(-120 + R() * 240, 130 + R() * 120, -80 + R() * 160); I.add(s); sp.push(s); }
      this.loops.push(t => sp.forEach((s, i) => s.scale.setScalar(4 + 3 * Math.abs(Math.sin(t * 2 + i)))));
      // the next map is a surprise
      const iq = this.sprite('?', { size: 150, color: '#8E7FD0' }); iq.position.set(0, 150, 0); I.add(iq); this.qs.push(iq); this.huds.push(iq);
      G.add(I); if (fP) { grow(B, 0.3); grow(I, 0.6); }
    }
    // the house stands as soon as its drawing is in (it builds itself then), before the reveal marks it done
    const src = hs.url || (hs.id ? 'id:' + hs.id : '');
    if (hs.status === 'current' && !src) { const q = this.sprite('?', { size: 170, color: '#8E7FD0' }); q.position.set(0, 150, -160); G.add(q); this.qs.push(q); this.huds.push(q); }
    // the house, rebuilt from their drawing (read once per drawing, then kept)
    if (src) {
      const HG = new THREE.Group(); G.add(HG); const built = this.cfg;
      const go = (d: HouseShape) => { if (this.cfg === built) this.buildHouse(HG, d, cfg, !lite && fr?.room === 'house'); };
      const hit = HOUSES.get(src);
      if (hit) go(hit);
      else (hs.url ? Promise.resolve(hs.url) : this.artLoader ? this.artLoader(hs.id!) : Promise.resolve(null))
        .then(url => (url ? loadHouse(url) : Promise.reject(new Error('no image of the house'))))
        .then(d => { HOUSES.set(src, d); go(d); }).catch(e => console.warn('house', e));
    }
    // the whole map finished: it comes alive with grass, fish jumping in the pond and insects about
    if (cfg.dream.alive && !lite) {
      let gp = 0, tr = 0;
      while (gp < 60 && tr < 2000) { tr++; const x = -600 + R() * 1200, z = -370 + R() * 780; if (x > HX0 - 20 && x < HX1 + 20 && z > HZ0 - 20 && z < HZ1 + 30) continue; if (Math.hypot(x - 380, z - 300) < 90) continue; gp++; const s = this.npic(GRASS[Math.floor(R() * GRASS.length)], 18 + R() * 16); s.position.set(x, 0, z); G.add(s); if (R() < 0.4) this.critters.push({ s, kind: 'sway', ph: R() * 6, amp: 0.05 }); }
      [0, 1, 2].forEach(i => this.fishAt(G, ['fish6', 'fish5', 'fish3'][i], 380 + (i - 1) * 24, 300, 0, i % 2 ? -1 : 1, 0.2, { size: 28, span: 40, H: 44, ph: i * 1.3, per: 3.4 + i * 0.5 }));
      ['dfly2', 'bfly3', 'bfly1'].forEach((k, i) => this.flyer(G, k, [380, -450, 450][i], [290, -250, -60][i], 60, { size: 30, ph: i * 2, r: 44 }));
      ['ladybug', 'beetle'].forEach((k, i) => { const s = this.npic(k, 14, 0.2); s.position.set(-200 + i * 360, 2, 340); G.add(s); this.critters.push({ s, kind: 'crawl', cx: -200 + i * 360, cz: 340, ph: i * 3 }); });
    }
    // the two of them walk about: in and out of the house through its door, and round the park
    if (this.cfg?.walkers && !lite && (!!src || Object.values(rooms).some(rr => (rr?.n || 0) > 0))) {
      const P = (x: number, z: number, p = 0, act: Stop['act'] = null, f?: 1 | -1, door = false): Stop => ({ x, z, p, act, f, door });
      const built = !!src, pDone = !!cfg.dream.bridged;
      const ground: Ground = (x, z) => {
        if (pDone) { if (x > 590 && x < 840 && z > 192 && z < 248) { const u = clamp((x - 600) / 230, 0, 1); return Math.sin(Math.PI * u) * 40 + u * 92; } if (Math.hypot(x - 960, z - 220) < 135) return 92; }
        if (x < -600 || x > 600 || z < -360 || z > 400) return null; if (pn >= 1 && Math.hypot(x - 380, z - 300) < 72) return null;
        if (built) {
          // the walls stop them; the front only lets them through the open door, and the inner wall through its doorway
          const D = this.door, inX = x > HX0 - 14 && x < HX1 + 14, inZ = z > HZ0 - 14 && z < HZ1 + 14;
          if (inX && z > HZ1 - 12 && z < HZ1 + 14) return D && D.open > 0.55 && x > D.x0 + 8 && x < D.x1 - 8 ? 0 : null;
          if (inX && z > HZ0 - 14 && z < HZ0 + 12) return null; if (inZ && (Math.abs(x - HX0) < 14 || Math.abs(x - HX1) < 14)) return null; if (inZ && Math.abs(x) < 12 && !(z > -205 && z < -115)) return null;
        }
        return 0;
      };
      const dc = this.door ? this.door.cx : -150;
      this.walker(G, 'd', 110, [P(-300, 190, 2.4, 'look', 1), P(dc, 80, 0, null, undefined, true), P(dc, -60, 0, null, undefined, true), P(-200, -140, 2.6, 'look', -1), P(dc, -60, 0, null, undefined, true), P(dc, 80, 0, null, undefined, true)], { ground, v: 34, y0: 0 });
      this.walker(G, 'a', 95, [P(-60, 320, 1.6, 'wave'), P(200, 250, 1, 'look', 1), P(300, 160, 1.2), P(-150, 230, 1, 'look', -1)], { ground, v: 60, hop: true, off: 1.5, y0: 0 });
    }
    return G;
  }

  /** A red pin bobbing at the edge of the map; while walking around, a trail of light leads from the house to it. */
  private pin(G: THREE.Group, lite: boolean) {
    const pin = this.face(import.meta.env.BASE_URL + 'dream/pin_red.png', lite ? 150 : 120); pin.renderOrder = 6; pin.position.set(PIN.x, 0, PIN.z); G.add(pin);
    const psh = new THREE.Mesh(this.disc ||= new THREE.CircleGeometry(1, 24), this.own(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false })));
    psh.rotation.x = -Math.PI / 2; psh.scale.set(28, 16, 1); psh.position.set(PIN.x, 1.5, PIN.z); G.add(psh);
    let TR: THREE.Group | null = null, N = 1;
    const tiles: { b: THREE.Mesh; mt: THREE.MeshBasicMaterial; i: number }[] = [], c0 = new THREE.Color('#6E95E8'), c1 = new THREE.Color('#F4F8FF');
    if (!lite) {
      this.pinPos = { x: PIN.x, z: PIN.z }; TR = new THREE.Group(); TR.visible = false; G.add(TR); const T = TR;
      const R = rnd(11), cv = new THREE.CatmullRomCurve3([[0, 80], [150, 140], [300, 190], [460, 205], [540, 218]].map(([x, z]) => new THREE.Vector3(x, 0, z))), tg = this.own(new THREE.BoxGeometry(34, 4, 34));
      N = Math.round(cv.getLength() / 48);
      cv.getSpacedPoints(N).forEach((p, i) => {
        const tn = cv.getTangentAt(Math.min(1, i / N)), mt = this.own(new THREE.MeshBasicMaterial({ color: '#6E95E8' })), b = new THREE.Mesh(tg, mt);
        b.position.set(p.x, 3, p.z); b.rotation.y = Math.atan2(tn.x, tn.z) + Math.PI / 4 + (R() - 0.5) * 0.4; b.scale.set(0.8 + R() * 0.35, 1, 0.7 + R() * 0.35); T.add(b); tiles.push({ b, mt, i });
      });
    }
    this.loops.push(t => {
      pin.position.y = this.reducedMotion ? 6 : Math.abs(Math.sin(t * 2.2)) * 16; psh.scale.set(28 - pin.position.y * 0.4, 16 - pin.position.y * 0.25, 1);
      // the trail shows only while walking around, with a pulse of light running along it towards the pin
      if (!TR) return; TR.visible = !!this.pov; if (!TR.visible) return;
      tiles.forEach(o => { const u = (((t * 0.32 - o.i / N) % 1) + 1) % 1, g = u < 0.18 ? 1 - u / 0.18 : 0; o.mt.color.lerpColors(c0, c1, g * 0.85); o.b.position.y = 3 + g * 5; });
    });
  }

  private frameDream(f: DreamFocus) {
    const key = 'dream:' + f; if (this.mode === key) return; this.mode = key; const c = this.controls, cam = this.camera;
    const F = DREAM_VIEW[f] || DREAM_VIEW.all;
    c.enabled = true; c.target.set(F[0][0], F[0][1], F[0][2]); cam.position.set(F[1][0], F[1][1], F[1][2]); c.minDistance = 350; c.maxDistance = 3600; this.fitCamera(); c.update();
  }

  private board(m: MonthCfg, i: number) {
    const B = new THREE.Group(); B.userData.pick = { type: 'month', mi: i };
    // each map stands on its own (no platform under it); an invisible area around it still takes the tap
    const hit = new THREE.Mesh(this.slabGeo ||= new THREE.BoxGeometry(1700, 28, 1300), this.own(new THREE.MeshBasicMaterial({ visible: false }))); hit.position.y = -14; B.add(hit);
    const mg = m.dream ? this.dream({ mode: 'dream', key: '', dream: m.dream }, { lite: true, mi: i }) : this.month(m.places, { labels: false, lite: true, mi: i });
    if (m.dream) mg.userData.alive = true;
    mg.scale.setScalar(0.85); mg.position.y = mg.userData.alive ? 72 : 34; B.add(mg);
    const s = this.sprite(m.name, { size: 52, pill: true, bg: m.current ? '#FFF3D1' : INK, color: m.current ? INK : '#FFF3D1', k: 1.3 }); s.position.set(-990, 40, 0); B.add(s);
    this.pickables.push(B); return B;
  }

  private build(cfg: MapConfig) {
    this.cfg = cfg; this.root.clear(); this.clearOwned();
    this.items = []; this.tweens = []; this.qs = []; this.pickables = []; this.grows = []; this.streams = []; this.loops = []; this.fx = [];
    this.flows = []; this.sway = []; this.sheep = []; this.pets = []; this.clouds = []; this.ripples = []; this.walkers = []; this.plants = []; this.huds = []; this.critters = []; this.door = null; this.me = null; this.pinPos = null;
    this.bubbles.forEach(b => this.scene.remove(b.s)); this.bubbles = [];
    if (this.pov) { this.pov = null; this.camera.fov = 30; this.camera.updateProjectionMatrix(); this.mode = null; this.joyEl.style.display = 'none'; this.keys.clear(); this.onPov(null); }
    if (cfg.mode === 'place') this.root.add(this.island(cfg.place, { fresh: cfg.fresh, fade: cfg.fade, q: true, S: 76, walk: true }));
    else if (cfg.mode === 'month') this.root.add(this.month(cfg.places, { pick: true, kind: cfg.kind }));
    else if (cfg.mode === 'dream') this.root.add(this.dream(cfg));
    else cfg.months.forEach((m, i) => { const b = this.board(m, i); b.position.y = -i * STEP; this.root.add(b); });
    this.frame(cfg.mode === 'dream' ? 'dream:' + (cfg.focus || 'all') : cfg.mode);
  }

  private frame(mode: string) {
    if (mode.startsWith('dream:')) { this.frameDream(mode.slice(6) as DreamFocus); return; }
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
    const c = this.controls, t = c.target, [bx, bz] = this.mode === 'place' ? [280, 190] : this.mode.startsWith('dream') ? [900, 450] : [800, 600];
    const x = clamp(t.x, -bx, bx), z = clamp(t.z, -bz, bz);
    if (x === t.x && z === t.z) return;
    this.camera.position.x += x - t.x; this.camera.position.z += z - t.z; t.x = x; t.z = z;
  }

  /** Portrait screens are narrow: pull the camera back so the whole island / map still fits. */
  private fitCamera() {
    if (!this.mode || this.mode === 'stack') return;
    const a = this.camera.aspect, k = a < 1.25 ? Math.min(1.9, 1.25 / a) : 1, c = this.controls, cam = this.camera;
    const dv = this.mode.startsWith('dream:') ? DREAM_VIEW[this.mode.slice(6) as DreamFocus] || DREAM_VIEW.all : null;
    const base = dv ? new THREE.Vector3(dv[1][0] - dv[0][0], dv[1][1] - dv[0][1], dv[1][2] - dv[0][2]) : this.mode === 'place' ? new THREE.Vector3(0, 520, 880) : new THREE.Vector3(0, 1450, 1750);
    const dir = cam.position.clone().sub(c.target); const len = base.length() * k;
    if (dir.lengthSq() < 1) dir.copy(base);
    cam.position.copy(c.target).add(dir.setLength(len));
    if (dv) { c.minDistance = 350 * k; c.maxDistance = 3600 * k; } else if (this.mode === 'place') { c.minDistance = 600 * k; c.maxDistance = 1500 * k; } else { c.minDistance = 1200 * k; c.maxDistance = 3200 * k; }
  }

  private pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    for (const h of rc.intersectObjects(this.pickables, true)) {
      let o: THREE.Object3D | null = h.object; while (o && !o.userData.pick && !o.userData.walker) o = o.parent; if (!o) continue;
      if (o.userData.walker) continue;
      this.onPick(o.userData.pick); return;
    }
  }

  /** Walk around the map in first person as a third character (null: back to the view from above). */
  setPov(who: Pov, silent = false) {
    const cam = this.camera; let W: Walker | undefined;
    if (who) {
      // they start next to Dadi (or the grandchild), on the same ground
      const ref = this.walkers.find(w => w.who === 'd') || this.walkers[0];
      if (ref && (!this.me || this.me.G !== ref.G)) {
        const s = new THREE.Sprite(); s.position.set(ref.s.position.x, ref.s.position.y, ref.s.position.z + 1);
        this.me = { s, G: ref.G, who: 'p', legs: [], total: 0, h: ref.who === 'd' ? ref.h : ref.h / 0.9, off: 0, face: 1, hop: false, y0: ref.y0, ground: ref.ground, speed: ref.speed, waveUntil: 0, parked: null };
      }
      W = ref ? this.me! : undefined;
    }
    if (who && !W) { this.setPov(null); return; }
    if (this.pov && W && this.pov.w === W) return;
    // the one we leave stays where we walked them to
    if (this.pov) { const o = this.pov.w; o.s.visible = true; if (W) o.parked = { x: this.pov.x, z: this.pov.z, y: this.pov.gy }; }
    if (!W) {
      this.pinFired = false; this.huds.forEach(s => (s.visible = true));
      if (this.pov) { this.pov = null; this.walkers.forEach(w => { w.parked = null; w.s.visible = true; }); cam.fov = 30; cam.updateProjectionMatrix(); const m = this.mode!; this.mode = null; this.frame(m); }
      this.joyEl.style.display = 'none'; this.keys.clear(); if (!silent) this.onPov(null); return;
    }
    let x: number, z: number, gy: number;
    if (W.parked) ({ x, z, y: gy } = W.parked);
    else { x = W.s.position.x; z = W.s.position.z; gy = W.ground(x, z) ?? W.s.position.y - W.y0; }
    W.parked = null; W.s.visible = false;
    // start out looking at Dadi, a few steps back so she is in view
    const other = this.walkers.find(w => w.who === 'd') || this.walkers[0]; let yaw = Math.atan2(-x, -z);
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
    // walking up to the pin unlocks the bridge
    if (this.pinPos && !this.pinFired && Math.hypot(P.x - this.pinPos.x, P.z - this.pinPos.z) < 80) { this.pinFired = true; setTimeout(() => this.onPin(), 300); }
  }

  private bubble(text: string, pos: THREE.Vector3, o: { bg?: string; color?: string } = {}) {
    const s = this.sprite(text, { size: 44, pill: true, bg: o.bg || '#FFF3D1', color: o.color || INK, k: 0.42 }); s.material.depthTest = false; s.renderOrder = 1000; s.position.copy(pos);
    this.scene.add(s); this.bubbles.push({ s, t0: now(), y0: pos.y });
  }

  /** Walking around: tap a drawing, a flower or the other one to say hello. */
  private povPick(e: PointerEvent) {
    const P = this.pov!, r = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const hit = rc.intersectObjects([...this.items.map(i => i.base), ...this.walkers.filter(w => w !== P.w).map(w => w.s), ...this.plants, ...this.pets], true)[0]; if (!hit) return;
    let o: THREE.Object3D | null = hit.object; while (o && !o.userData.item && !o.userData.walker && !o.userData.plant && !o.userData.say) o = o.parent; if (!o) return;
    const n = now(), wp = o.getWorldPosition(new THREE.Vector3());
    if (hit.distance > (P.w.speed > 200 ? 420 : 330)) { this.bubble('Walk closer!', wp.add(new THREE.Vector3(0, 60, 0))); return; }
    if (o.userData.walker) { const w = o.userData.walker as Walker; w.waveUntil = n + 2.4; this.bubble('Hi there!', wp.add(new THREE.Vector3(0, w.h * 1.1, 0)), { bg: w.who === 'd' ? DADI : CHILD, color: '#FFF3D1' }); return; }
    if (o.userData.say) { this.bubble(o.userData.say, wp.add(new THREE.Vector3(0, 46, 0))); return; }
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
    for (const g of this.grows) { const k = (n - g.at) / 0.9; if (k <= 0) g.o.scale.setScalar(0.0001); else g.o.scale.copy(g.s).multiplyScalar(Math.max(0.0001, easeBack(Math.min(1, k)))); }
    this.grows = this.grows.filter(g => n - g.at < 0.9);
    this.fx = this.fx.filter(f => f(n));
    const A = this.reducedMotion ? 0.25 : 1, tv = this.tv;
    for (const f of this.flows) { const u = (t * 0.02 * A + f.i / f.n) % 1, p = f.curve.getPointAt(u), d = f.curve.getTangentAt(u); f.o.position.set(p.x + Math.sin(f.i * 2.3) * 9, -23.4, p.z); tv.set(f.o.position.x + d.x, -23.4, f.o.position.z + d.z); f.o.lookAt(tv); }
    for (const s of this.sway) s.o.rotation.z = Math.sin(t * 0.8 + s.ph) * 0.05 * A;
    for (const s of this.sheep) { const k = t * A; s.o.position.set(s.cx + Math.sin(k * 0.15 + s.ph) * 28, -26 + Math.abs(Math.sin(k * 2 + s.ph)) * 2, s.cz + Math.cos(k * 0.12 + s.ph) * 18); s.o.rotation.y = Math.sin(k * 0.15 + s.ph) > 0 ? 0 : Math.PI;
      const sp = s.o.children[0]; if (sp instanceof THREE.Sprite && sp.userData.w) sp.scale.x = (Math.cos(k * 0.15 + s.ph) > 0 ? -1 : 1) * sp.userData.w; }
    for (const c of this.clouds) c.o.position.x = (((c.x0 + t * c.v * A + 900) % 1800) + 1800) % 1800 - 900;
    for (const r of this.ripples) { const k = (t * 0.25 * A + r.ph) % 1; r.o.scale.set(r.R * (0.3 + k * 0.65), 30, r.R * (0.3 + k * 0.65)); r.m.opacity = (1 - k) * 0.8; }
    for (const c of this.plants) { const p = c.userData.plant, b = p.base as THREE.Vector3; if (!p.pop) continue; const k = (n - p.pop) / 0.8, s = Math.sin(k * Math.PI); if (k < 1) c.scale.set(b.x * (1 + 0.5 * s), b.y * (1 + 0.8 * s), b.z * (1 + 0.5 * s)); else { p.pop = 0; c.scale.copy(b); } }
    for (const s of this.streams) {
      s.o.visible = !s.from || n > s.from; if (!s.o.visible) continue;
      const u = (((t * 0.035 * s.speed * A + s.i / s.n) % 1) + 1) % 1, p = s.curve.getPointAt(u), d = s.curve.getTangentAt(u), off = Math.sin(s.i * 2.3) * 6;
      s.o.position.set(p.x - d.z * off, 3.4, p.z + d.x * off); s.o.rotation.y = Math.atan2(d.x, d.z);
    }
    for (const f of this.loops) f(t * A);
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
    for (const c of this.critters) {
      const s = c.s, m = s.material as THREE.SpriteMaterial, k = t * A;
      if (c.at && n < c.at) { s.visible = false; continue; }
      if (c.kind === 'fly') { s.visible = true; const a = k * 0.7 + c.ph, x = c.cx + Math.cos(a) * c.r, z = c.cz + Math.sin(a * 1.3) * c.r * 0.6, vx = -Math.sin(a); s.position.set(x, c.y0 + Math.sin(k * 2.4 + c.ph) * 7, z); const f = c.flap ? 0.4 + 0.6 * Math.abs(Math.sin(t * 11 * A + c.ph)) : 1; s.scale.x = s.userData.w * f * (vx > 0 ? -1 : 1); m.rotation = Math.sin(k * 3 + c.ph) * 0.15; }
      else if (c.kind === 'fish') { const q = ((((k + c.ph) % c.per) + c.per) % c.per) / 1.15; if (q > 1) { s.visible = false; continue; } s.visible = true; const sd = c.dx >= 0 ? 1 : -1; s.position.set(c.x0 + (q - 0.5) * c.span * c.dx, c.y0 - 6 + Math.sin(Math.PI * q) * c.H, c.z0 + (q - 0.5) * c.span * c.dz); s.scale.x = s.userData.w * sd * c.face; m.rotation = sd * Math.cos(Math.PI * q) * 0.8; }
      else if (c.kind === 'crawl') { s.visible = true; const a = k * 0.25 + c.ph; s.position.x = c.cx + Math.sin(a) * 10; s.position.z = c.cz + Math.cos(a * 0.8) * 6; }
      else m.rotation = Math.sin(k * 1.5 + c.ph) * c.amp;
    }
    for (const q of this.qs) { q.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.4); q.position.y = 150 + Math.sin(t * 1.2) * 6; }
    this.renderer.render(this.scene, this.camera);
  };
}
