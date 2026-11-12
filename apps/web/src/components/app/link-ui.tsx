import { Link2, Mail, type LucideIcon } from 'lucide-react';
import { PlatformIcon, type PlatformKey } from '../ui/platform-icon';
import type { LinkChannel } from './links-data';

const PLATFORM_OF: Partial<Record<LinkChannel, PlatformKey>> = {
  pinterest: 'PINTEREST',
  instagram: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  etsy: 'ETSY',
};
const ICON_OF: Partial<Record<LinkChannel, LucideIcon>> = { email: Mail };

export function ChannelIcon({ channel }: { channel: LinkChannel }) {
  const platform = PLATFORM_OF[channel];
  if (platform) return <PlatformIcon platform={platform} size={15} strokeWidth={1.75} />;
  const Icon = ICON_OF[channel] ?? Link2;
  return <Icon size={15} strokeWidth={1.75} aria-hidden="true" />;
}

/** "gushka.ua/shop/rug" — the destination without the scheme and `www.`. */
export const shortDestination = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return url;
  }
};
