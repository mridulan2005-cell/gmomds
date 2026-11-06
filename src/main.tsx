import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Keep a pinch or double-tap from zooming the whole app on iPad.
document.addEventListener('gesturestart', e => e.preventDefault());
let lastTouch = 0;
document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastTouch < 320 && !(e.target as HTMLElement).closest('input')) e.preventDefault(); lastTouch = n; }, { passive: false });

// A soft tap sound on every button press. Web Audio keeps it instant and lets taps overlap.
let tapCtx: AudioContext | null = null;
let tapBuf: AudioBuffer | null = null;
let tapLoading = false;
function playTap() {
  try {
    tapCtx ??= new AudioContext();
    if (tapCtx.state === 'suspended') tapCtx.resume();
    if (!tapBuf) {
      if (!tapLoading) {
        tapLoading = true;
        fetch(import.meta.env.BASE_URL + 'tap.mp3').then(r => r.arrayBuffer()).then(b => tapCtx!.decodeAudioData(b))
          .then(buf => { tapBuf = buf; playTap(); }).catch(() => { tapLoading = false; });
      }
      return;
    }
    const src = tapCtx.createBufferSource(); src.buffer = tapBuf;
    const gain = tapCtx.createGain(); gain.gain.value = 0.6;
    src.connect(gain).connect(tapCtx.destination); src.start();
  } catch { /* no audio: stay silent */ }
}
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement | null)?.closest('button, [role="button"]') as HTMLButtonElement | null;
  if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') playTap();
}, true);
