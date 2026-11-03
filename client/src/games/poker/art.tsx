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
        <clipPath id={id('goldside')}>
          <path d="M18 86v9a28 9 0 0 0 56 0v-9z" />
        </clipPath>
        <clipPath id={id('limeside')}>
          <path d="M18 74v9a28 9 0 0 0 56 0v-9z" />
        </clipPath>
        <clipPath id={id('lilacside')}>
          <path d="M18 62v9a28 9 0 0 0 56 0v-9z" />
        </clipPath>
        <radialGradient id={id('face')} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#d8d0f5" />
          <stop offset="1" stopColor="#7d6dbf" />
        </radialGradient>
      </defs>
      {/* The stack: each chip's side carries the edge inserts a casino chip has, spaced round it (narrower towards the sides) and clipped to the side so none pokes past it; the top chip's face has an even ring of inserts and an inner ring. */}
      <g>
        <path d="M18 86v9a28 9 0 0 0 56 0v-9z" fill="#b07f24" />
        <g clipPath={url('goldside')} fill="#ffffff" opacity=".85">
          <rect x="43.8" y="86" width="4.4" height="20" />
          <rect x="20.65" y="86" width="2.2" height="20" />
          <rect x="69.15" y="86" width="2.2" height="20" />
        </g>
        <ellipse cx="46" cy="86" rx="28" ry="9" fill={url('gold')} />
        <path d="M18 74v9a28 9 0 0 0 56 0v-9z" fill="#7fa236" />
        <g clipPath={url('limeside')} fill="#ffffff" opacity=".85">
          <rect x="43.8" y="74" width="4.4" height="20" />
          <rect x="20.65" y="74" width="2.2" height="20" />
          <rect x="69.15" y="74" width="2.2" height="20" />
        </g>
        <ellipse cx="46" cy="74" rx="28" ry="9" fill={url('lime')} />
        <path d="M18 62v9a28 9 0 0 0 56 0v-9z" fill="#6a5bb0" />
        <g clipPath={url('lilacside')} fill="#ffffff" opacity=".85">
          <rect x="43.8" y="62" width="4.4" height="20" />
          <rect x="20.65" y="62" width="2.2" height="20" />
          <rect x="69.15" y="62" width="2.2" height="20" />
        </g>
        <ellipse cx="46" cy="62" rx="28" ry="9" fill={url('lilac')} />
        <ellipse cx="46" cy="62" rx="22.4" ry="7.2" fill="none" stroke="#ffffff" strokeWidth="2.6" pathLength={100} strokeDasharray="8.333 8.333" strokeDashoffset="4.167" opacity=".9" />
        <ellipse cx="46" cy="62" rx="13.6" ry="4.4" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity=".75" />
        <path d="M28 58.5c4-2 9-3 15-3.2" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
      </g>
      {/* The chip leaning on the stack, face on: its inserts sit inside its edge, so its outline stays a clean circle. */}
      <g transform="rotate(12 90 70)">
        <circle cx="90" cy="70" r="20" fill={url('face')} />
        <circle cx="90" cy="70" r="19.2" fill="none" stroke="#5e4fa3" strokeWidth="1.6" opacity=".55" />
        <circle cx="90" cy="70" r="15.6" fill="none" stroke="#ffffff" strokeWidth="4.6" pathLength={100} strokeDasharray="8.333 8.333" opacity=".92" />
        <circle cx="90" cy="70" r="9.6" fill="none" stroke="#ffffff" strokeWidth="1.8" opacity=".8" />
        <path d="M80 62a12 12 0 0 1 8-5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      </g>
      <path d="M30 26l2.4 5.8 6.2 2.4-6.2 2.4-2.4 6.2-2.4-6.2-6.2-2.4 6.2-2.4z" fill="#f4d181" />
    </ShadedArt>
  );
}
