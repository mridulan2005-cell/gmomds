export type PersonId = 'dadi' | 'child';
export type Motion = 'fly' | 'swim' | 'sway' | 'float' | 'spin' | 'bounce' | 'swing' | 'flicker' | 'breathe' | 'rock' | 'flow' | 'walk' | 'hop' | 'none';
export type Spot = 'sky' | 'ground' | 'water';

export interface Paths {
  f: string[]; s: string[]; fc?: (string | null)[];
  /** cut-out of the whole drawing, extruded as-is into 3D */
  sil?: { outer: string[]; holes: string[] };
  /** where the drawing's own image (stored as 'art:<id>') sits in the 64 box */
  artBox?: [number, number, number, number];
}

export interface Guess { kind: string; label: string; motion: Motion; place: Spot }
export interface Recognition extends Guess { confidence: number; alternatives: Guess[]; source: 'claude' | 'local'; /** the photo is not a drawing on paper */ notDrawing?: boolean }

export interface Drawing {
  id: string;
  personId: PersonId;
  promptId: string;
  createdAt: number;
  paths: Paths;
  kind: string;
  label: string;
  motion: Motion;
  place: Spot;
  fillColor: string;
  confidence: number;
  alternatives: Guess[];
  source: 'claude' | 'local' | 'sample';
  hasArt?: boolean;
}

/** `single`: one shared drawing (the dream house), so dadi and child are the same drawing */
export interface Pair { promptId: string; prompt: string; /** the prompt in Hindi, when it was made with one */ hi?: string; dadi: string; child: string; slot: number; together?: boolean; single?: boolean; title?: string }
export type PlaceStatus = 'locked' | 'current' | 'done';
export interface Place {
  id: string; index: number; name: string; theme: string; shape: 'A' | 'B' | 'C' | 'D'; color: string; status: PlaceStatus; pairs: Pair[];
  /** pairs that finish this place (PAIRS when missing) */
  total?: number;
  /** a curated place's prompts, in order (else prompts are made from the theme and their loves) */
  prompts?: { text: string; together?: boolean; title?: string; rule?: string; single?: boolean }[];
  /** a room of the Dream House (it is built as one house, not as an island) */
  room?: 'lr' | 'kitchen' | 'house' | 'park' | 'bridge';
}
export interface Month { id: string; name: string; places: Place[]; /** the Dream House: its places are rooms of one house */ dream?: boolean }
export interface Prompt { id: string; text: string; /** the same prompt in Hindi (made by the server along with it) */ hi?: string; date: string; placeId: string; together?: boolean; title?: string; rule?: string; single?: boolean }

export interface AppState {
  version: 1;
  onboarded: boolean;
  names: { dadi: string; child: string };
  /** who the grandchild plays with (Grandmother, Grandfather, Mom, Dad); the grown-up's name falls back to it */
  role?: string;
  loves: { dadi: string[]; child: string[] };
  /** the caricatures they drew of each other (a PNG data URL, or the placeholder sketch); they walk around the maps */
  faces: { dadi: string; child: string };
  months: Month[]; // maps (a town, a hillside…), newest first; months[0] is the map in progress
  drawings: Record<string, Drawing>;
  prompt: Prompt | null;
  recentPrompts: string[];
  scanning: { promptId: string; dadi?: string } | null; // a pair in progress
  lastFresh: { placeId: string; slot: number } | null;  // newest pair, rises on the map once
  /** when today's pair was finished; the next prompt arrives 24 hours later */
  doneAt?: number;
  examples?: boolean; // the finished example maps were added
  /** the language they are comfortable in (English name, e.g. 'Hindi'); chosen first in onboarding */
  lang?: string;
  /** the Dream House's pin was reached while walking around: its last prompt (the bridge) is unlocked */
  pinReached?: boolean;
}
