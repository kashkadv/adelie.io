// Which product a link points to (ADR-0018: promotion → sales). Pure — unit-tested.

/**
 * A stable key of the product behind a URL, e.g. `etsy:913041795`, or null. Etsy links come as
 * listing pages (`/listing/<id>/…`, with or without a locale prefix) or as shop pages that name
 * a listing (`?listing_id=<id>`).
 */
export function productLinkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'etsy.com' || host.endsWith('.etsy.com')) {
    const listing =
      /\/listing\/(\d+)/.exec(parsed.pathname)?.[1] ?? parsed.searchParams.get('listing_id');
    return listing && /^\d+$/.test(listing) ? `etsy:${listing}` : null;
  }
  return null;
}
