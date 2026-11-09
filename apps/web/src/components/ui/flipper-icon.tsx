import Image from 'next/image';

/**
 * Flipper's own mark — the waving penguin — in place of a line icon. Takes `size` like the lucide
 * icons so it fits the same slots; `strokeWidth` is accepted and ignored.
 */
export function FlipperIcon({
  size = 20,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}) {
  return (
    <Image
      src="/flipper.webp"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
