import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Keep a pinch or double-tap from zooming the whole app on iPad.
document.addEventListener('gesturestart', e => e.preventDefault());
let lastTouch = 0;
document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastTouch < 320 && !(e.target as HTMLElement).closest('input')) e.preventDefault(); lastTouch = n; }, { passive: false });
