/**
 * Where a visit came from (Flipper, ADR-0022): the parts — source, medium, campaign… — and the
 * channel they make up, from the landing address's parameters and the referrer. The parts are
 * kept apart from the channel, so the channel rules can change and old visits be read again.
 * Rules follow the GA4 default channel grouping; UTM values are labels someone typed, not proof.
 */

export interface Visit {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  clickIdType: string | null;
  channel: string;
  referrerHost: string | null;
}

/** Search engines, by the name in their host ("google" for google.com, google.com.ua…). */
const SEARCH = [
  'google',
  'bing',
  'duckduckgo',
  'yahoo',
  'yandex',
  'ecosia',
  'baidu',
  'brave',
  'startpage',
  'qwant',
  'ukr',
  'seznam',
];

/** Hosts (without www) of social networks → the source's name. */
const SOCIAL: [RegExp, string][] = [
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'pinterest'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(facebook|fb)\.com$|^fb\.me$/, 'facebook'],
  [/^(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)threads\.net$/, 'threads'],
  [/^(t\.me|telegram\.org|web\.telegram\.org)$/, 'telegram'],
  [/(^|\.)vk\.com$/, 'vk'],
];

const PAID = new Set(['cpc', 'ppc', 'paidsearch', 'paid_search', 'paid-search', 'cpm', 'cpv']);
const PAID_SOCIAL = new Set([
  'paid_social',
  'paidsocial',
  'paid-social',
  'social_paid',
  'social-paid',
]);
const ORGANIC_SOCIAL = new Set([
  'organic_social',
  'organic-social',
  'social',
  'social-network',
  'social_network',
  'social-media',
  'social_media',
  'sm',
]);
const EMAIL = new Set(['email', 'e-mail', 'e_mail', 'newsletter']);
const DISPLAY = new Set(['display', 'banner', 'expandable', 'interstitial']);

const clean = (v: string | null | undefined, max = 100): string | null => {
  const t = (v ?? '').trim().toLowerCase().slice(0, max);
  return t || null;
};

const hostOf = (raw: string | null | undefined): string | null => {
  try {
    return new URL(raw ?? '').hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
};

const searchSource = (host: string | null): string | null => {
  if (!host) return null;
  const parts = host.split('.');
  return SEARCH.find((s) => parts.includes(s)) ?? null;
};

const socialSource = (host: string | null): string | null => {
  if (!host) return null;
  for (const [pattern, name] of SOCIAL) if (pattern.test(host)) return name;
  return null;
};

/** Classifies a visit. `ownHost`: the site's own host — a referrer from it is not a source. */
export function classifyVisit(input: {
  landing?: string | null;
  referrer?: string | null;
  ownHost?: string | null;
}): Visit {
  let params = new URLSearchParams();
  try {
    params = new URL(input.landing ?? '').searchParams;
  } catch {
    // no landing address: the referrer alone decides
  }
  const own = (input.ownHost ?? '').replace(/^www\./, '').toLowerCase();
  const refHost = hostOf(input.referrer);
  const referrerHost = refHost && refHost !== own ? refHost : null;

  let source = clean(params.get('utm_source'));
  let medium = clean(params.get('utm_medium'));
  let clickIdType: string | null = null;
  for (const [id, platform, paid] of [
    ['gclid', 'google', true],
    ['msclkid', 'bing', true],
    ['ttclid', 'tiktok', true],
    ['fbclid', 'facebook', false],
    ['epik', 'pinterest', false],
  ] as const) {
    if (params.get(id)) {
      clickIdType ??= id;
      // A click id says where the click came from — and that it was an ad, for the ad platforms.
      source ??= platform;
      if (paid) medium ??= platform === 'tiktok' ? 'paid_social' : 'cpc';
    }
  }

  // No labels: the referrer.
  if (!source && referrerHost) {
    const search = searchSource(referrerHost);
    const social = socialSource(referrerHost);
    if (search) {
      source = search;
      medium ??= 'organic';
    } else if (social) {
      source = social;
      medium ??= 'social';
    } else {
      source = referrerHost;
      medium ??= 'referral';
    }
  }
  if (!source && !medium && !referrerHost) {
    return {
      source: null,
      medium: null,
      campaign: clean(params.get('utm_campaign')),
      content: clean(params.get('utm_content')),
      term: clean(params.get('utm_term')),
      clickIdType,
      channel: 'Direct',
      referrerHost,
    };
  }

  const isSearch = !!source && !!searchSource(source.includes('.') ? source : `${source}.com`);
  const isSocial = !!source && !!socialSource(source.includes('.') ? source : `${source}.com`);
  const m = medium ?? '';
  let channel: string;
  if (PAID_SOCIAL.has(m) || (PAID.has(m) && isSocial)) channel = 'Paid Social';
  else if (PAID.has(m) && (isSearch || !isSocial) && m !== 'cpm' && m !== 'cpv')
    channel = 'Paid Search';
  else if (DISPLAY.has(m) || m === 'cpm') channel = 'Display';
  else if (ORGANIC_SOCIAL.has(m) || (isSocial && !PAID.has(m))) channel = 'Organic Social';
  else if (m === 'organic' || (isSearch && !PAID.has(m))) channel = 'Organic Search';
  else if (EMAIL.has(m)) channel = 'Email';
  else if (m === 'affiliate') channel = 'Affiliate';
  else if (m === 'referral' || (!m && referrerHost)) channel = 'Referral';
  else channel = 'Other';

  return {
    source,
    medium,
    campaign: clean(params.get('utm_campaign')),
    content: clean(params.get('utm_content')),
    term: clean(params.get('utm_term')),
    clickIdType,
    channel,
    referrerHost,
  };
}
