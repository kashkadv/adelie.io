// go.adelie.space — short links of Link Builder (ADR-0027). A Cloudflare Worker: it reads where a
// code leads from Workers KV (written by the API) and redirects; the click goes to the API in the
// background. The redirect never waits for — or depends on — the home server.
//
// Bindings (set by deploy.sh): LINKS (KV namespace), API_URL, CLICK_SECRET (secret).

const CODE = /^\/([a-z0-9]{7})\/?$/;
const HOME = 'https://adelie.space/';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const match = CODE.exec(url.pathname);
    if (!match) {
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow:\n', {
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return Response.redirect(HOME, 302);
    }
    const code = match[1];
    const target = await env.LINKS.get(code, { cacheTtl: 60 });
    if (!target) {
      return new Response('Link not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (request.method === 'GET' && env.API_URL && env.CLICK_SECRET) {
      ctx.waitUntil(
        fetch(`${env.API_URL}/go/clicks`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.CLICK_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            at: Date.now(),
            ua: request.headers.get('User-Agent') ?? '',
            referrer: request.headers.get('Referer') ?? '',
            country: request.cf?.country ?? null,
          }),
        }).catch(() => undefined),
      );
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer-when-downgrade',
      },
    });
  },
};
