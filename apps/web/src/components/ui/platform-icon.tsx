import { Pin, type LucideProps } from 'lucide-react';

export type PlatformKey = 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK';

/** Instagram-style glyph (lucide has no brand icons): rounded square, lens, flash dot. */
function InstagramGlyph({ size = 24, strokeWidth = 2, className, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Icon of a social platform (no brand colours — ADR-0009 penguin tones). */
export function PlatformIcon({ platform, ...props }: LucideProps & { platform: PlatformKey }) {
  return platform === 'INSTAGRAM' ? <InstagramGlyph {...props} /> : <Pin {...props} />;
}
