/** Blackjack’s lobby picture: the ace of spades over a dotted green card back, and a gold chip in front, in the shaded style (GameArt.tsx). */
import { ShadedArt, useArtIds } from '../../platform/components/GameArt';

export function BlackjackArt() {
  const { id, url } = useArtIds();
  return (
    <ShadedArt game="blackjack">
      <defs>
        <linearGradient id={id('back')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b2ecc4" />
          <stop offset="1" stopColor="#4fae73" />
        </linearGradient>
        <linearGradient id={id('face')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ebe9df" />
        </linearGradient>
        <linearGradient id={id('chip')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8dd9c" />
          <stop offset="1" stopColor="#d9a93f" />
        </linearGradient>
        <pattern id={id('dots')} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.2" fill="#ffffff" opacity=".45" />
        </pattern>
      </defs>
      <g transform="rotate(-14 44 58)">
        <rect x="20" y="24" width="48" height="68" rx="8" fill={url('back')} />
        <rect x="25" y="29" width="38" height="58" rx="5" fill={url('dots')} stroke="#ffffff" strokeOpacity=".6" strokeWidth="1.5" />
      </g>
      <g transform="rotate(10 72 60)">
        <rect x="48" y="24" width="48" height="68" rx="8" fill={url('face')} />
        <path d="M54.5 41l4-11 4 11M56 37h5" fill="none" stroke="#262a24" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M72 46c0 0-13 9.5-13 17.5 0 5.4 5.6 7.8 10.4 4.6L67 76h10l-2.4-7.9c4.8 3.2 10.4.8 10.4-4.6C85 55.5 72 46 72 46z" fill="#262a24" />
        <path d="M66 54c1.5-2 3-3.4 4-4.2" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
      <ellipse cx="90" cy="98" rx="16" ry="5.5" fill="#b07f24" />
      <rect x="74" y="91" width="32" height="7" fill="#c99a35" />
      <ellipse cx="90" cy="91" rx="16" ry="5.5" fill={url('chip')} />
      <ellipse cx="90" cy="91" rx="9.5" ry="3.2" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeDasharray="3 3" />
      <path d="M76 93.5v4M83 95v4M97 95v4M104 93.5v4" stroke="#ffffff" strokeWidth="2" opacity=".7" />
    </ShadedArt>
  );
}
