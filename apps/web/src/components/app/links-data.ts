// Link Builder (ADR-0027): what the API returns. Channels in the order the form offers them.
export const LINK_CHANNELS = [
  'pinterest',
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'threads',
  'telegram',
  'reddit',
  'x',
  'etsy',
  'email',
  'other',
] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

export interface TrackedLink {
  id: string;
  code: string;
  name: string | null;
  destination: string;
  source: string;
  medium: string;
  campaign: string | null;
  content: string;
  channel: LinkChannel;
  /** The destination with the labels. */
  url: string;
  /** go.adelie.space/<code>; null while it has not reached Cloudflare (or short links are off). */
  shortUrl: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface LinkRow extends TrackedLink {
  clicks: number;
  /** Null: the destination is not a project site with Flipper. */
  site: {
    visits: number;
    visitors: number;
    conversions: number;
    value: number | null;
    currency: string | null;
  } | null;
}
