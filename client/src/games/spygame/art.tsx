/** The Spy Game’s lobby picture: a spy in a lilac hat with a lime band, a shadowed face with only the eyes showing, a chunky coral scarf with lime stripes and a tan coat with the collar up, in the shaded style (GameArt.tsx). */
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
        <linearGradient id={id('collar')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9b97f" />
          <stop offset="1" stopColor="#a5803f" />
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
      <path d="M18 118c0-23 15-37 42-37s42 14 42 37z" fill={url('coat')} />
      <path d="M27 100c2.4-7 7-12.6 13.6-15.6" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".45" />
      <path d="M50 84l10 22 10-22z" fill="#2b2f2a" />
      <path d="M58 85L38 73c-4.6 9-4 20 3 30z" fill={url('collar')} />
      <path d="M62 85l20-12c4.6 9 4 20-3 30z" fill={url('collar')} />
      <circle cx="60" cy="110.5" r="2.2" fill="#8f6c33" />
      <circle cx="60" cy="116.5" r="2.2" fill="#8f6c33" />
      <ellipse cx="60" cy="61" rx="19" ry="21" fill={url('face')} />
      <ellipse cx="52" cy="59" rx="3.6" ry="2.4" fill="#ffffff" />
      <ellipse cx="68" cy="59" rx="3.6" ry="2.4" fill="#ffffff" />
      <circle cx="53.4" cy="59" r="1.4" fill="#171a16" />
      <circle cx="69.4" cy="59" r="1.4" fill="#171a16" />
      {/* The scarf: a thick wrap over the lower face, knotted at one side, its two tails hanging over the coat with lime stripes (the hat band's lime) and a short fringe. */}
      <g transform="rotate(9 56 80)">
        <path d="M51.5 80h10.5l-1.2 22.4c-.1 1.5-1.3 2.6-2.8 2.6h-3.4c-1.5 0-2.7-1.1-2.8-2.6z" fill="#cf5f48" />
        <path d="M52 92.5h9.6M52.2 97.5h9.2" stroke="#c7e976" strokeWidth="2.4" />
        <path d="M54.4 105.2v2.8M56.8 105.4v3M59.2 105.2v2.8" stroke="#b44c37" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path d="M43 80h12l-1.2 26.4c-.1 1.6-1.4 2.8-3 2.8h-3.6c-1.6 0-2.9-1.2-3-2.8z" fill={url('tail')} />
      <path d="M43.6 95h10.8M43.8 100h10.4" stroke="#c7e976" strokeWidth="2.4" />
      <path d="M46.4 109.2v3M49 109.4v3.2M51.6 109.2v3" stroke="#c8573f" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M37 66.5c7 5 15 7.4 23 7.4s16-2.4 23-7.4l1 12.6c-7 5.6-15.6 8.4-24 8.4s-17-2.8-24-8.4z" fill={url('scarf')} />
      <path d="M38.6 74c7 4.6 14.4 6.8 21.4 6.8S74.4 78.6 81.4 74" fill="none" stroke="#c8573f" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <path d="M42 70.2c5.4 3 11.6 4.6 18 4.8" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
      <ellipse cx="49" cy="81" rx="7.6" ry="6.2" fill="#e77b63" />
      <path d="M44.6 82.4c2.8 1.4 5.8 1.5 8.8.4" fill="none" stroke="#c8573f" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
      <path d="M45.4 78.4c1.4-.9 3.2-1.4 5-1.4" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" opacity=".6" />
      <ellipse cx="60" cy="46" rx="38" ry="9" fill={url('brim')} />
      <path d="M38 45c0-19 9-27 22-27s22 8 22 27c-7 2.4-14 3.4-22 3.4S45 47.4 38 45z" fill={url('hat')} />
      <path d="M38.4 37.5c7 2.4 14 3.4 21.6 3.4s14.6-1 21.6-3.4l.4 7.5c-7 2.4-14 3.4-22 3.4s-15-1-22-3.4z" fill="#c7e976" />
      <path d="M50 23c-4 2-7 6-8.5 11" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    </ShadedArt>
  );
}
