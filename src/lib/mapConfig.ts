import type { AppState, Drawing, Place } from './types';
import type { DrawCfg, MonthCfg, PlaceCfg } from '../map/MapScene';

export function drawCfg(d: Drawing | undefined): DrawCfg | null {
  if (!d) return null;
  return { id: d.id, f: d.paths.f, s: d.paths.s, fc: d.paths.fc, fill: d.fillColor, owner: d.personId === 'dadi' ? 'd' : 'a', motion: d.motion, place: d.place, sil: d.paths.sil, artBox: d.paths.artBox, art: !!d.hasArt, kind: d.kind, label: d.label };
}

export function placeCfg(s: AppState, p: Place, status = p.status): PlaceCfg {
  return {
    name: p.name, shape: p.shape, color: p.color, theme: p.theme, status, total: p.total,
    pairs: p.pairs.map(pr => [drawCfg(s.drawings[pr.dadi]), drawCfg(s.drawings[pr.child])] as [DrawCfg, DrawCfg]),
  };
}

export function stackCfg(s: AppState): MonthCfg[] {
  return s.months.slice(0, 8).map((m, i) => ({ name: m.name, current: i === 0, places: m.places.map(p => placeCfg(s, p)) }));
}
