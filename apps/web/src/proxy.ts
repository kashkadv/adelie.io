import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side gate for app pages: without a session cookie the visitor is redirected to /login
 * before anything renders (no flash of the dashboard). Whether the session is still valid is
 * checked by the app itself (AppFrame) — the proxy only looks at the cookie, so it adds no latency.
 *
 * The cookie is set by the API (Better Auth). Locally both run on localhost, which shares cookies
 * across ports; on deployed environments the API must set it for the parent domain.
 */
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

/** Pages that work without signing in. */
const PUBLIC_PATHS = ['/login', '/register', '/connect'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except Next internals and static files (icons, logo, fonts).
  matcher: [
    '/((?!_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|logo\\.svg|.*\\.(?:png|svg|ico|woff2?)$).*)',
  ],
};
