/** Poker’s lobby picture: a stack of gold, lime and lilac chips with a lilac chip leaning on it face out, and a gold sparkle, in the shaded style (GameArt.tsx). */
import { ShadedArt, useArtIds } from '../../platform/components/GameArt';

export function PokerArt() {
  const { id, url } = useArtIds();
  return (
    <ShadedArt game="poker">
      <defs>
        <linearGradient id={id('gold')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8dd9c" />
          <stop offset="1" stopColor="#e2b04a" />
        </linearGradient>
        <linearGradient id={id('lime')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2f7a6" />
          <stop offset="1" stopColor="#a6cc52" />
        </linearGradient>
        <linearGradient id={id('lilac')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8d0f5" />
          <stop offset="1" stopColor="#8f80cc" />
        </linearGradient>
        <radialGradient id={id('face')} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#d8d0f5" />
          <stop offset="1" stopColor="#7d6dbf" />
        </radialGradient>
      </defs>
      <g>
        <path d="M18 86v9a28 9 0 0 0 56 0v-9z" fill="#b07f24" />
        <path d="M22 91v5M32 93.5v5M46 94.5v5M60 93.5v5M70 91v5" stroke="#ffffff" strokeWidth="3" opacity=".75" />
        <ellipse cx="46" cy="86" rx="28" ry="9" fill={url('gold')} />
        <path d="M18 74v9a28 9 0 0 0 56 0v-9z" fill="#7fa236" />
        <path d="M22 79v5M32 81.5v5M46 82.5v5M60 81.5v5M70 79v5" stroke="#ffffff" strokeWidth="3" opacity=".75" />
        <ellipse cx="46" cy="74" rx="28" ry="9" fill={url('lime')} />
        <path d="M18 62v9a28 9 0 0 0 56 0v-9z" fill="#6a5bb0" />
        <path d="M22 67v5M32 69.5v5M46 70.5v5M60 69.5v5M70 67v5" stroke="#ffffff" strokeWidth="3" opacity=".75" />
        <ellipse cx="46" cy="62" rx="28" ry="9" fill={url('lilac')} />
        <ellipse cx="46" cy="62" rx="17" ry="5.4" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="4 3.4" opacity=".85" />
        <path d="M28 58.5c4-2 9-3 15-3.2" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
      </g>
      <g transform="rotate(12 90 70)">
        <circle cx="90" cy="70" r="20" fill={url('face')} />
        <circle cx="90" cy="70" r="20" fill="none" stroke="#ffffff" strokeWidth="5" strokeDasharray="6 6.6" opacity=".9" />
        <circle cx="90" cy="70" r="11" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".8" />
        <path d="M80 62a12 12 0 0 1 8-5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      </g>
      <path d="M30 26l2.4 5.8 6.2 2.4-6.2 2.4-2.4 6.2-2.4-6.2-6.2-2.4 6.2-2.4z" fill="#f4d181" />
    </ShadedArt>
  );
}
