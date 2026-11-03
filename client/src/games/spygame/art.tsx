/** The Spy Game’s lobby picture: a spy in a lilac hat with a lime band, a shadowed face with only the eyes showing, a coral scarf and a tan coat with the collar up, in the shaded style (GameArt.tsx). */
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
      <path d="M39 70c6.4 4.4 13.4 6.6 21 6.6S74.6 74.4 81 70v10.4c-6.4 4.4-13.4 6.6-21 6.6s-14.6-2.2-21-6.6z" fill={url('scarf')} />
      <path d="M43 73.4c5 2.6 10.4 4 16 4.2" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
      <path d="M66.5 82.5h9.5l-1.6 19.5c-.2 1.8-1.6 3-3.2 3s-3-1.2-3.2-3z" fill={url('tail')} />
      <path d="M68.6 104.4v3M71.2 104.8v3.2M73.8 104.4v3" stroke="#c8573f" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="64.5" y="76.5" width="12" height="9" rx="4" fill="#e77b63" />
      <ellipse cx="60" cy="46" rx="38" ry="9" fill={url('brim')} />
      <path d="M38 45c0-19 9-27 22-27s22 8 22 27c-7 2.4-14 3.4-22 3.4S45 47.4 38 45z" fill={url('hat')} />
      <path d="M38.4 37.5c7 2.4 14 3.4 21.6 3.4s14.6-1 21.6-3.4l.4 7.5c-7 2.4-14 3.4-22 3.4s-15-1-22-3.4z" fill="#c7e976" />
      <path d="M50 23c-4 2-7 6-8.5 11" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    </ShadedArt>
  );
}
