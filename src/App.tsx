import { useEffect, useLayoutEffect, useState } from 'react';
import { ensurePrompt, load, useApp, useLoaded } from './lib/store';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Scan } from './screens/Scan';
import { Sketches } from './screens/Sketches';
import { MapView } from './screens/MapView';
import { Scrapbook } from './screens/Scrapbook';
import type { Dest } from './components';

export type Route =
  | { screen: 'onboard' } | { screen: 'home' } | { screen: 'scan'; who: 'dadi' | 'child'; replace?: string } | { screen: 'sketches' }
  | { screen: 'stack' } | { screen: 'interior'; mi: number } | { screen: 'place'; placeId: string } | { screen: 'reveal' }
  | { screen: 'book'; placeId?: string };
export type Go = (r: Route) => void;

/** Logical canvas: 1280 wide in landscape, 860 in portrait, height follows the screen. Scaled to fit any iPad. */
function useStage() {
  const calc = () => {
    const vw = window.innerWidth, vh = window.innerHeight, portrait = vh > vw * 1.05;
    const baseW = portrait ? 860 : 1280, minH = portrait ? 1080 : 780;
    const scale = Math.min(vw / baseW, vh / minH) || 1; // 0 × 0 while the window is hidden
    return { scale, W: vw / scale, H: vh / scale, portrait };
  };
  const [s, setS] = useState(calc);
  useLayoutEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return s;
}

export function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), on = () => setR(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return r;
}

export default function App() {
  const st = useStage(), s = useApp(), loaded = useLoaded();
  const [route, setRoute] = useState<Route | null>(null);
  useEffect(() => { void load(); }, []);
  // while developing, every reload brings a fresh prompt (for testing)
  useEffect(() => { if (loaded && !route) { setRoute(s.onboarded ? { screen: 'home' } : { screen: 'onboard' }); if (s.onboarded) void ensurePrompt(import.meta.env.DEV); } }, [loaded]);
  // a new day while the app stays open
  useEffect(() => { const t = setInterval(() => { if (s.onboarded) void ensurePrompt(); }, 60_000); const v = () => document.visibilityState === 'visible' && s.onboarded && ensurePrompt(); document.addEventListener('visibilitychange', v); return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); }; }, [s.onboarded]);

  const go: Go = r => setRoute(r);
  const dest = (d: Dest) => go(d === 'home' ? { screen: 'home' } : d === 'map' ? { screen: 'stack' } : { screen: 'book' });

  let body = <div className="splash">Dadi's Map</div>;
  if (route) {
    const r = route;
    if (r.screen === 'onboard') body = <Onboarding go={go} />;
    else if (r.screen === 'home') body = <Home go={go} dest={dest} />;
    else if (r.screen === 'scan') body = <Scan key={r.who + (r.replace || '')} who={r.who} replace={r.replace} go={go} />;
    else if (r.screen === 'sketches') body = <Sketches go={go} />;
    else if (r.screen === 'book') body = <Scrapbook go={go} dest={dest} placeId={r.placeId} />;
    else body = <MapView key={r.screen + ('placeId' in r ? r.placeId : '') + ('mi' in r ? r.mi : '')} route={r} go={go} dest={dest} />;
  }

  return (
    <div className="viewport">
      <div className={'stage' + (st.portrait ? ' portrait' : '')} style={{ width: st.W, height: st.H, transform: `scale(${st.scale})`, ['--scale' as string]: st.scale, ['--W' as string]: st.W + 'px', ['--H' as string]: st.H + 'px' }}>
        {body}
      </div>
    </div>
  );
}
