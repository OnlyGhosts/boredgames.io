/** Scribble’s lobby picture: a lime pencil with a wooden tip, a metal band and a coral eraser, over the lilac squiggle it drew, with a gold sparkle, in the shaded style (GameArt.tsx). */
import { ShadedArt, useArtIds } from '../../platform/components/GameArt';

export function ScribbleArt() {
  const { id, url } = useArtIds();
  return (
    <ShadedArt game="scribble">
      <defs>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2f7a6" />
          <stop offset=".5" stopColor="#c7e976" />
          <stop offset="1" stopColor="#93bb3e" />
        </linearGradient>
        <linearGradient id={id('wood')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe7c2" />
          <stop offset="1" stopColor="#e2bd7e" />
        </linearGradient>
        <linearGradient id={id('eraser')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7b3a3" />
          <stop offset="1" stopColor="#e0735c" />
        </linearGradient>
        <linearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1f2ec" />
          <stop offset=".5" stopColor="#b9beb1" />
          <stop offset="1" stopColor="#8e9488" />
        </linearGradient>
      </defs>
      {/* The squiggle: a deep lilac edge round a paler lilac line, so it reads as a solid stroke on the dark tile and on the picked lilac one alike. */}
      <path d="M14 98c9-11 18 9 28-1s19-11 28-1 17 9 25 0" fill="none" stroke="#5e4fa3" strokeWidth="10" strokeLinecap="round" />
      <path d="M14 98c9-11 18 9 28-1s19-11 28-1 17 9 25 0" fill="none" stroke="#b9aee8" strokeWidth="6.4" strokeLinecap="round" />
      <path d="M14 98c9-11 18 9 28-1s19-11 28-1 17 9 25 0" fill="none" stroke="#ece8fb" strokeWidth="2" strokeLinecap="round" transform="translate(0 -1.4)" opacity=".85" />
      <g transform="rotate(-38 62 58)">
        {/* Under the pencil and hidden by it (inset from every outline): where two of its parts meet edge to edge (the tip and the body, the body and the band, the band and the eraser), their two anti-aliased edges would let the tile show through as a seam; this keeps the pencil under them. */}
        <path d="M29.5 49.5H86v17H29.5z" fill={url('body')} />
        <path d="M91 53.5h3v9h-3z" fill={url('band')} />
        <path d="M30 48L12 58l18 10z" fill={url('wood')} />
        <path d="M18.5 54.4L12 58l6.5 3.6z" fill="#262a24" />
        <rect x="30" y="48" width="54" height="20" fill={url('body')} />
        <rect x="30" y="50" width="54" height="4" fill="#ffffff" opacity=".45" />
        <rect x="84" y="47" width="9" height="22" rx="1.5" fill={url('band')} />
        <path d="M86.5 47v22M90 47v22" stroke="#7d8378" strokeWidth=".9" opacity=".7" />
        <rect x="93" y="47" width="14" height="22" rx="6" fill={url('eraser')} />
        <rect x="95" y="49.5" width="9" height="3.5" rx="1.75" fill="#ffffff" opacity=".5" />
      </g>
      <path d="M98 18l2.6 6.4L107 27l-6.4 2.6L98 36l-2.6-6.4L89 27l6.4-2.6z" fill="#f4d181" />
    </ShadedArt>
  );
}
