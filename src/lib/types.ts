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

export interface Pair { promptId: string; prompt: string; dadi: string; child: string; slot: number }
export type PlaceStatus = 'locked' | 'current' | 'done';
export interface Place { id: string; index: number; name: string; theme: string; shape: 'A' | 'B' | 'C' | 'D'; color: string; status: PlaceStatus; pairs: Pair[] }
export interface Month { id: string; name: string; places: Place[] }
export interface Prompt { id: string; text: string; date: string; placeId: string }

export interface AppState {
  version: 1;
  onboarded: boolean;
  names: { dadi: string; child: string };
  loves: { dadi: string[]; child: string[] };
  months: Month[]; // maps (a town, a hillside…), newest first; months[0] is the map in progress
  drawings: Record<string, Drawing>;
  prompt: Prompt | null;
  recentPrompts: string[];
  scanning: { promptId: string; dadi?: string } | null; // a pair in progress
  lastFresh: { placeId: string; slot: number } | null;  // newest pair, rises on the map once
  examples?: boolean; // the finished example maps were added
}
