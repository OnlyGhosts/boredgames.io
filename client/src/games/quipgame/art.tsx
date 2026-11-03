/** Quip Game’s lobby picture: a white speech bubble that is still typing in front of a lilac one, with a gold and a lime sparkle, in the shaded style (GameArt.tsx). */
import { ShadedArt, useArtIds } from '../../platform/components/GameArt';

export function QuipgameArt() {
  const { id, url } = useArtIds();
  return (
    <ShadedArt game="quipgame">
      <defs>
        <linearGradient id={id('back')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfc5f2" />
          <stop offset="1" stopColor="#8676c6" />
        </linearGradient>
        <linearGradient id={id('front')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6e4da" />
        </linearGradient>
      </defs>
      <path d="M58 18h38a14 14 0 0 1 14 14v16a14 14 0 0 1-14 14h-2l2 12-14-12H58a14 14 0 0 1-14-14V32a14 14 0 0 1 14-14z" fill={url('back')} />
      <path d="M60 24h22" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="M24 42h42a15 15 0 0 1 15 15v17a15 15 0 0 1-15 15H44l-17 14 3-14h-6A15 15 0 0 1 9 74V57a15 15 0 0 1 15-15z" fill={url('front')} />
      <path d="M18 50c2-2 5-3 8-3" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="66" r="5" fill="#262a24" />
      <circle cx="45" cy="66" r="5" fill="#262a24" />
      <circle cx="60" cy="66" r="5" fill="#262a24" />
      <path d="M98 82l2.2 5.4 5.8 2.2-5.8 2.2L98 97.2l-2.2-5.4L90 89.6l5.8-2.2z" fill="#f4d181" />
      <path d="M16 22l1.6 3.9 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#c7e976" />
    </ShadedArt>
  );
}
