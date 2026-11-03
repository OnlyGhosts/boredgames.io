/** The Spy Game’s lobby picture: a spy in a lilac hat with a lime band, a shadowed face with only the eyes showing, a smooth coral scarf over the chin with one plain tail, and a tan coat with two buttons, in the shaded style (GameArt.tsx). */
import { ShadedArt, useArtIds } from '../../platform/components/GameArt';

export function SpygameArt() {
  const { id, url } = useArtIds();
  return (
    <ShadedArt game="spygame">
      <defs>
        <linearGradient id={id('coat')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ead2a2" />
          <stop offset="1" stopColor="#b8925a" />
        </linearGradient>
        <linearGradient id={id('hat')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfc5f2" />
          <stop offset="1" stopColor="#8676c6" />
        </linearGradient>
        <linearGradient id={id('brim')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9a8ad6" />
          <stop offset="1" stopColor="#5e4fa3" />
        </linearGradient>
        <linearGradient id={id('scarf')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6ad9b" />
          <stop offset="1" stopColor="#df6a52" />
        </linearGradient>
        <linearGradient id={id('tail')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e77b63" />
          <stop offset="1" stopColor="#c8573f" />
        </linearGradient>
        <radialGradient id={id('face')} cx=".5" cy=".4" r=".7">
          <stop offset="0" stopColor="#3b4139" />
          <stop offset="1" stopColor="#171a16" />
        </radialGradient>
      </defs>
      <path d="M16 118c0-22 16-36 44-36s44 14 44 36z" fill={url('coat')} />
      <path d="M26 101c2.6-7.4 7.4-13 14-16" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".45" />
      <circle cx="65" cy="100" r="2.3" fill="#8f6c33" />
      <circle cx="65" cy="108" r="2.3" fill="#8f6c33" />
      <ellipse cx="60" cy="60" rx="19" ry="21" fill={url('face')} />
      <ellipse cx="52" cy="58" rx="3.6" ry="2.4" fill="#ffffff" />
      <ellipse cx="68" cy="58" rx="3.6" ry="2.4" fill="#ffffff" />
      <circle cx="53.4" cy="58" r="1.4" fill="#171a16" />
      <circle cx="69.4" cy="58" r="1.4" fill="#171a16" />
      {/* The scarf: one smooth wrap over the chin that drapes onto the shoulders (its lower edge overlaps the coat, so no tile shows between them), and its single plain tail hanging over the coat. */}
      <path d="M45 88h12l-1 24a3 3 0 0 1-3 2.8h-4a3 3 0 0 1-3-2.8z" fill={url('tail')} />
      <path d="M37 67c7 5 15 7.4 23 7.4s16-2.4 23-7.4l3 22c-7 3.4-16 5-26 5s-19-1.6-26-5z" fill={url('scarf')} />
      <path d="M42 70.6c5.4 3 11.6 4.6 18 4.8" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
      <ellipse cx="60" cy="45" rx="38" ry="9" fill={url('brim')} />
      <path d="M38 44c0-19 9-27 22-27s22 8 22 27c-7 2.4-14 3.4-22 3.4S45 46.4 38 44z" fill={url('hat')} />
      <path d="M38.4 36.5c7 2.4 14 3.4 21.6 3.4s14.6-1 21.6-3.4l.4 7.5c-7 2.4-14 3.4-22 3.4s-15-1-22-3.4z" fill="#c7e976" />
      <path d="M50 22c-4 2-7 6-8.5 11" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    </ShadedArt>
  );
}
