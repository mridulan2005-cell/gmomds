// Hand-drawn icons, in the style of the onboarding tile drawings: a wobbly dark marker line
// over crayon colour that sits a little off the lines. Every icon is drawn in a 100-unit box.
import type { ReactNode } from 'react';

const INK = '#1E1B26', CREAM = '#FFF3D1', ORANGE = '#F26A2E', SUN = '#FFC93C', PINK = '#FF9CC2';

/** The two roughening filters every icon uses; rendered once at the root of the app. */
export function HandDrawnDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="hd-line" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="4" />
        </filter>
        <filter id="hd-fill" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.13" numOctaves="3" seed="9" />
          <feDisplacementMap in="SourceGraphic" scale="7" />
        </filter>
      </defs>
    </svg>
  );
}

/** colour (offset, rough edges) under ink (wobbly marker) */
function Hd({ w, h, vb = '0 0 100 100', fill, ink, sw = 7, label }: { w: number; h: number; vb?: string; fill?: ReactNode; ink: ReactNode; sw?: number; label?: string }) {
  return (
    <svg width={w} height={h} viewBox={vb} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} style={{ overflow: 'visible', flex: 'none' }}>
      {fill && <g filter="url(#hd-fill)" transform="translate(5 4)">{fill}</g>}
      <g filter="url(#hd-line)" fill="none" stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{ink}</g>
    </svg>
  );
}

const ARROW = 'M6 24 H56 V8 L94 32 L56 56 V40 H6 Z';
export const Arrow = ({ w = 42, h = 28 }: { w?: number; h?: number }) => (
  <Hd w={w} h={h} vb="0 0 100 64" sw={6} fill={<path d={ARROW} fill={CREAM} />} ink={<path d={ARROW} />} />
);

export const Chevron = ({ dir, size = 26 }: { dir: 'l' | 'r'; size?: number }) => {
  const d = dir === 'l' ? 'M64 14 L30 50 L64 86' : 'M36 14 L70 50 L36 86';
  return <Hd w={size} h={size} sw={11} fill={<path d={d} fill="none" stroke={ORANGE} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />} ink={<path d={d} />} />;
};

export const CloseIcon = ({ size = 18 }: { size?: number }) => {
  const d = 'M24 24 L76 76 M76 24 L24 76';
  return <Hd w={size} h={size} sw={11} fill={<path d={d} stroke={ORANGE} strokeWidth="20" strokeLinecap="round" />} ink={<path d={d} />} />;
};

const STAR = 'M50 6 Q57 43 94 50 Q57 57 50 94 Q43 57 6 50 Q43 43 50 6 Z';
export const TodayIcon = ({ size = 30 }: { size?: number }) => <Hd w={size} h={size} fill={<path d={STAR} fill={SUN} />} ink={<path d={STAR} />} />;

const MAP = 'M8 22 L34 12 L66 24 L92 14 V78 L66 88 L34 76 L8 86 Z';
export const MapIcon = ({ size = 34 }: { size?: number }) => (
  <Hd w={size} h={size}
    fill={<><path d={MAP} fill="#F6D58A" /><path d="M42 36 Q54 28 60 40 Q64 54 50 58 Q38 56 42 36 Z" fill="#9BD770" /></>}
    ink={<><path d={MAP} /><path d="M34 12 V76 M66 24 V88" /><path d="M18 68 Q32 52 48 60 T80 34" stroke={ORANGE} strokeWidth="5" strokeDasharray="1 10" /><path d="M74 28 L86 40 M86 28 L74 40" strokeWidth="6" /></>} />
);

const COVER = 'M24 8 H80 Q88 8 88 16 V84 Q88 92 80 92 H24 Z';
export const BookIcon = ({ size = 34 }: { size?: number }) => (
  <Hd w={size} h={size}
    fill={<><path d={COVER} fill="#5B86E5" /><path d="M42 28 H76 V50 H42 Z" fill={CREAM} /></>}
    ink={<><path d={COVER} /><path d="M42 28 H76 V50 H42 Z" strokeWidth="5" />
      {[20, 38, 56, 74].map(y => <path key={y} d={`M30 ${y} Q12 ${y - 2} 16 ${y + 6} Q20 ${y + 12} 30 ${y + 8}`} strokeWidth="5" />)}
      <path d="M50 70 Q59 62 68 70" strokeWidth="5" /></>} />
);

// a cog: eight rounded teeth around a hole
const GEAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 - Math.PI / 16, r = i % 2 ? 31 : 43; pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`); }
  return 'M' + pts.join(' L') + ' Z';
})();
export const GearIcon = ({ size = 30 }: { size?: number }) => (
  <Hd w={size} h={size} sw={6} fill={<path d={GEAR} fill="#BFD9F7" />} ink={<><path d={GEAR} /><circle cx="50" cy="50" r="12" /></>} />
);

export const MicIcon = ({ size = 44 }: { size?: number }) => (
  <Hd w={size} h={size}
    fill={<rect x="36" y="6" width="28" height="48" rx="14" fill={PINK} />}
    ink={<><rect x="36" y="6" width="28" height="48" rx="14" /><path d="M22 42 Q22 72 50 72 Q78 72 78 42 M50 72 V90 M34 92 H66" /><path d="M44 22 H56 M44 34 H56" strokeWidth="5" /></>} />
);

export const PencilIcon = ({ size = 48 }: { size?: number }) => (
  <Hd w={size} h={size}
    fill={<><path d="M22 62 L62 22 L78 38 L38 78 Z" fill={SUN} /><path d="M22 62 L12 88 L38 78 Z" fill="#F4D3A1" /><path d="M62 22 L70 14 Q76 8 82 14 L86 18 Q92 24 86 30 L78 38 Z" fill={PINK} /></>}
    ink={<><path d="M22 62 L62 22 L78 38 L38 78 Z" /><path d="M22 62 L12 88 L38 78" /><path d="M62 22 L70 14 Q76 8 82 14 L86 18 Q92 24 86 30 L78 38" /><path d="M30 70 L70 30" strokeWidth="5" /><path d="M14 82 L12 88 L18 86" strokeWidth="8" /></>} />
);

export const EraserIcon = ({ size = 48 }: { size?: number }) => (
  <Hd w={size} h={size}
    fill={<g transform="rotate(-35 50 52)"><rect x="14" y="34" width="72" height="36" rx="7" fill={PINK} /><rect x="52" y="34" width="34" height="36" rx="7" fill="#7FA8F0" /></g>}
    ink={<><g transform="rotate(-35 50 52)"><rect x="14" y="34" width="72" height="36" rx="7" /><path d="M52 34 V70" /></g><path d="M18 92 L30 92 M40 92 L46 92" strokeWidth="5" /></>} />
);

export const CheckIcon = ({ size = 40 }: { size?: number }) => {
  const d = 'M20 54 L42 76 L82 26';
  return <Hd w={size} h={size} sw={11} fill={<path d={d} fill="none" stroke={CREAM} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />} ink={<path d={d} />} />;
};
