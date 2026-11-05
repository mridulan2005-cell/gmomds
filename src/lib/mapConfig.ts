import type { AppState, Drawing, Month, Place } from './types';
import type { DrawCfg, DreamCfg, MonthCfg, PlaceCfg } from '../map/MapScene';

export function drawCfg(d: Drawing | undefined): DrawCfg | null {
  if (!d) return null;
  return { id: d.id, f: d.paths.f, s: d.paths.s, fc: d.paths.fc, fill: d.fillColor, owner: d.personId === 'dadi' ? 'd' : 'a', motion: d.motion, place: d.place, sil: d.paths.sil, artBox: d.paths.artBox, art: !!d.hasArt, kind: d.kind, label: d.label };
}

export function placeCfg(s: AppState, p: Place, status = p.status): PlaceCfg {
  return {
    name: p.name, shape: p.shape, color: p.color, theme: p.theme, status, total: p.total,
    // one shared drawing (a collaborative task) stands on the island once
    pairs: p.pairs.map(pr => [drawCfg(s.drawings[pr.dadi]), pr.single ? null : drawCfg(s.drawings[pr.child])] as [DrawCfg, DrawCfg]),
  };
}

/**
 * The Dream House as one house: each of its places is a room (Living Room, Kitchen, the house, the Park).
 * `override` changes one room's status (the reveal shows the room finished before it is saved).
 */
export function dreamCfg(s: AppState, m: Month, override?: { placeId: string; status: Place['status'] }): DreamCfg {
  const out: DreamCfg = { rooms: {}, house: { status: 'locked' } };
  for (const p of m.places) {
    const status = override?.placeId === p.id ? override.status : p.status;
    if (p.room === 'house') {
      const d = p.pairs[0] && s.drawings[p.pairs[0].dadi];
      // a sample house (no scan) is the prototype's drawing of one; a scanned one is its own picture
      out.house = { status, ...(d ? (d.hasArt ? { id: d.id } : { url: import.meta.env.BASE_URL + 'dream/house.svg' }) : {}) };
    } else if (p.room) out.rooms[p.room] = { status, n: p.pairs.length, pairs: p.pairs.map(pr => [drawCfg(s.drawings[pr.dadi]), pr.single ? null : drawCfg(s.drawings[pr.child])] as [DrawCfg | null, DrawCfg | null]) };
  }
  out.alive = m.places.every(p => (override?.placeId === p.id ? override.status : p.status) === 'done');
  return out;
}

export function stackCfg(s: AppState): MonthCfg[] {
  return s.months.slice(0, 8).map((m, i) => ({ name: m.name, current: i === 0, places: m.places.map(p => placeCfg(s, p)), ...(m.dream ? { dream: dreamCfg(s, m) } : {}) }));
}
