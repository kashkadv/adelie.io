// The short form's table in Workers KV (ADR-0027): `<code>` → the full address, read by the Worker
// on go.adelie.space. Written with the Cloudflare API; the token never leaves the server.
import { config } from '../config.js';

const kvUrl = (code: string) => {
  const c = config.shortLinks!;
  return `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/storage/kv/namespaces/${c.namespaceId}/values/${encodeURIComponent(code)}`;
};

/** The short address of a code, or null when short links are not set up. */
export const shortUrlOf = (code: string): string | null =>
  config.shortLinks ? `${config.shortLinks.baseUrl}/${code}` : null;

/** Writes (or rewrites) where a short link leads. False when it did not reach Cloudflare. */
export async function publishShortLink(code: string, url: string): Promise<boolean> {
  if (!config.shortLinks) return false;
  try {
    const res = await fetch(kvUrl(code), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.shortLinks.apiToken}`,
        'Content-Type': 'text/plain',
      },
      body: url,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
