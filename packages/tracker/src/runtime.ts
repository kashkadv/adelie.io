// Flipper in the browser (ADR-0022). Written to be harmless: nothing here throws into the page,
// nothing blocks it, and without consent nothing is stored in the browser at all.
import {
  CAMPAIGN_PARAMS,
  cleanProperties,
  cleanUrl,
  hostOf,
  propertiesFromAttributes,
  randomId,
  type Properties,
} from './core.js';

export const VERSION = '1.0.0';

const VISITOR_COOKIE = '_fl_v';
const SESSION_COOKIE = '_fl_s';
const ATTRIBUTION_COOKIE = '_fl_a';
const VISITOR_DAYS = 400;
const SESSION_MS = 30 * 60 * 1000;
const FLUSH_MS = 1500;
const MAX_BATCH = 20;
/** The address parameter that carries the visitor between the owner's own domains. */
const LINK_PARAM = '_fl';

export interface Env {
  win: Window & typeof globalThis;
  doc: Document;
  /** The tag that loaded the script (it carries the site id and the options). */
  script: HTMLScriptElement | null;
  now?: () => number;
}

type Consent = 'unknown' | 'granted' | 'denied';

interface Wire {
  id: string;
  n: string;
  t: number;
  u: string;
  ti: string;
  p: Properties;
  a?: { l: string; r: string };
}

interface Product {
  id?: string | number;
  name?: string;
  price?: number;
  currency?: string;
  category?: string;
  brand?: string;
  variant?: string;
  quantity?: number;
}

/** The public face: `flipper('track', 'AddToCart', {…})`, or `flipper.track(…)`. */
export interface Flipper {
  (...args: unknown[]): void;
  track(name: string, properties?: Record<string, unknown>): void;
  consent(state: 'granted' | 'denied'): void;
  pageview(): void;
  viewCategory(category: { id?: string | number; name?: string; items?: Product[] }): void;
  productView(product: Product): void;
  addToCart(product: Product, quantity?: number): void;
  beginCheckout(cart: {
    items: Product[];
    value?: number;
    currency?: string;
    coupon?: string;
  }): void;
  purchase(order: {
    id?: string | number;
    items?: Product[];
    value?: number;
    currency?: string;
    coupon?: string;
    shipping?: number;
    tax?: number;
  }): void;
  debug(on?: boolean): void;
  version: string;
  loaded: true;
}

const productProps = (p: Product) => ({
  item_id: p.id === undefined ? undefined : String(p.id),
  item_name: p.name,
  price: p.price,
  currency: p.currency,
  category: p.category,
  brand: p.brand,
  variant: p.variant,
  quantity: p.quantity,
});

export function init(env: Env): Flipper | null {
  const { win, doc, script } = env;
  const now = env.now ?? (() => Date.now());
  const existing = (win as unknown as { flipper?: { loaded?: boolean; q?: unknown[] } }).flipper;
  if (existing?.loaded) return null;
  const site = script?.getAttribute('data-site-id')?.trim();
  if (!site || !script) return null;

  const attr = (name: string) => script.getAttribute(`data-${name}`);
  const endpoint =
    attr('endpoint') ||
    `${new URL(script.src || win.location.href, win.location.href).origin}/collect`;
  const allow = (attr('allow-params') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const linkDomains = (attr('link-domains') ?? '')
    .split(',')
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/^www\./, ''),
    )
    .filter(Boolean);
  const spa = attr('spa') !== 'false';
  const auto = attr('auto-pageview') !== 'false';
  const outbound = attr('outbound') !== 'false';
  let debug = attr('debug') === 'true' || /[?&]flipper_debug=1\b/.test(win.location.search);
  // The page's own attribute wins; else the mode the cabinet set (baked into the script).
  const configured = (win as unknown as { __flipperConfig?: { consent?: string } }).__flipperConfig;
  const mode = attr('consent') ?? configured?.consent;
  let consent: Consent = mode === 'granted' ? 'granted' : 'unknown';

  // A person who asked not to be tracked (Do Not Track, Global Privacy Control) is not.
  const nav = win.navigator as Navigator & { globalPrivacyControl?: boolean };
  const optedOut = nav.doNotTrack === '1' || nav.globalPrivacyControl === true;

  let queue: Wire[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPage = '';
  let lastPageAt = 0;
  /** A visitor id that came on a link from another domain of the owner, until consent allows it. */
  let linked: string | null = null;

  const log = (...args: unknown[]) => {
    if (debug) console.log('[flipper]', ...args);
  };
  const safe =
    <T extends unknown[]>(fn: (...a: T) => void) =>
    (...a: T) => {
      try {
        fn(...a);
      } catch (error) {
        log('error', error);
      }
    };

  // ---------- cookies (only ever touched with consent) ----------
  const getCookie = (name: string): string | null => {
    const m = doc.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]!) : null;
  };
  const setCookie = (name: string, value: string, days?: number) => {
    const expires = days ? `; expires=${new Date(now() + days * 864e5).toUTCString()}` : '';
    const secure = win.location.protocol === 'https:' ? '; Secure' : '';
    doc.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax${secure}`;
  };

  // ---------- where a visit came from ----------
  const externalReferrer = (): string => {
    const ref = doc.referrer;
    const host = hostOf(ref);
    const own = hostOf(win.location.href);
    if (!ref || !host || host === own || linkDomains.includes(host)) return '';
    return cleanUrl(ref, [], false);
  };
  const campaignSignature = (url: string): string => {
    try {
      const q = new URL(url).searchParams;
      return CAMPAIGN_PARAMS.map((k) => q.get(k) ?? '')
        .join('|')
        .replace(/^\|+$/, '');
    } catch {
      return '';
    }
  };

  /** Visitor, session and the attribution the session began with — full mode only. */
  const identity = (): { v: string; s: string; a: { l: string; r: string } } | null => {
    if (consent !== 'granted') return null;
    let v = getCookie(VISITOR_COOKIE);
    if (linked && /^[0-9a-f]{32}$/.test(linked)) {
      v = linked;
      linked = null;
      setCookie(VISITOR_COOKIE, v, VISITOR_DAYS);
    }
    if (!v || !/^[0-9a-f]{32}$/.test(v)) {
      v = randomId();
      setCookie(VISITOR_COOKIE, v, VISITOR_DAYS);
    }
    const t = now();
    const [sid, last] = (getCookie(SESSION_COOKIE) ?? '').split('.');
    let attribution: { l: string; r: string } | null = null;
    try {
      attribution = JSON.parse(getCookie(ATTRIBUTION_COOKIE) ?? 'null');
    } catch {
      attribution = null;
    }
    const here = cleanUrl(win.location.href, allow);
    const campaign = campaignSignature(here);
    // A new session after 30 minutes of silence, or when a visit arrives with another campaign.
    const fresh =
      !sid ||
      !last ||
      t - Number(last) > SESSION_MS ||
      !attribution ||
      (campaign !== '' && campaign !== campaignSignature(attribution.l));
    const session = fresh ? randomId() : sid!;
    if (fresh) {
      attribution = { l: here, r: externalReferrer() };
      setCookie(ATTRIBUTION_COOKIE, JSON.stringify(attribution));
    }
    setCookie(SESSION_COOKIE, `${session}.${t}`);
    return { v, s: session, a: attribution! };
  };

  // ---------- sending ----------
  const transport = (body: string) => {
    log('send', body);
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      if (nav.sendBeacon?.(endpoint, blob)) return;
    } catch {
      // fall through to fetch
    }
    try {
      void win
        .fetch(endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          mode: 'no-cors',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
        })
        .catch(() => undefined);
    } catch {
      // the event is lost; the page is not
    }
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    while (queue.length) {
      const events = queue.splice(0, MAX_BATCH);
      const id = identity();
      transport(
        JSON.stringify({
          s: site,
          c: id ? 1 : 0,
          ...(id ? { v: id.v, ss: id.s, a: id.a } : {}),
          e: events,
        }),
      );
    }
  };

  const enqueue = (event: Wire) => {
    if (optedOut || consent === 'denied') return;
    queue.push(event);
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(safe(flush), FLUSH_MS);
  };

  // ---------- events ----------
  const track = safe((name: string, properties?: Record<string, unknown>) => {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) return;
    const u = cleanUrl(win.location.href, allow);
    if (!u) return;
    const event: Wire = {
      id: randomId(),
      n: name,
      t: now(),
      u,
      ti: (doc.title ?? '').slice(0, 150),
      p: cleanProperties(properties),
    };
    // Without consent there is no session to carry where the visit came from: a page view that
    // looks like an arrival (another site, or a campaign address) says it itself.
    if (name === 'PageView' && consent !== 'granted') {
      const r = externalReferrer();
      if (r || campaignSignature(u)) event.a = { l: u, r };
    }
    log('event', event);
    enqueue(event);
  });

  const pageview = safe(() => {
    const u = cleanUrl(win.location.href, allow);
    const t = now();
    if (u === lastPage && t - lastPageAt < 500) return;
    lastPage = u;
    lastPageAt = t;
    track('PageView');
  });

  // ---------- the public API ----------
  const api = ((...args: unknown[]) => {
    const [cmd, ...rest] = args;
    const method = (api as unknown as Record<string, unknown>)[String(cmd)];
    if (typeof method === 'function' && cmd !== 'version')
      safe(method as (...a: unknown[]) => void)(...rest);
  }) as Flipper;
  api.track = track;
  api.pageview = pageview;
  api.consent = safe((state: 'granted' | 'denied') => {
    if (state !== 'granted' && state !== 'denied') return;
    // What was waiting was collected under the old state: it goes out under it.
    flush();
    consent = state;
    log('consent', state);
  });
  api.viewCategory = (c) =>
    track('ViewCategory', {
      category_id: c.id === undefined ? undefined : String(c.id),
      category_name: c.name,
      item_count: c.items?.length,
      items: c.items?.map(productProps),
    });
  api.productView = (p) => track('ProductView', productProps(p));
  api.addToCart = (p, quantity = p.quantity ?? 1) =>
    track('AddToCart', {
      ...productProps(p),
      quantity,
      value: typeof p.price === 'number' ? Math.round(p.price * quantity * 100) / 100 : undefined,
    });
  api.beginCheckout = (cart) => {
    const items = cart.items ?? [];
    const sum = items.reduce((n, p) => n + (p.price ?? 0) * (p.quantity ?? 1), 0);
    track('BeginCheckout', {
      value: cart.value ?? Math.round(sum * 100) / 100,
      currency: cart.currency ?? items[0]?.currency,
      coupon: cart.coupon,
      item_count: items.reduce((n, p) => n + (p.quantity ?? 1), 0),
      items: items.map(productProps),
    });
  };
  api.purchase = (o) => {
    const items = o.items ?? [];
    const sum = items.reduce((n, p) => n + (p.price ?? 0) * (p.quantity ?? 1), 0);
    track('Purchase', {
      transaction_id: o.id === undefined ? undefined : String(o.id),
      value: o.value ?? (items.length ? Math.round(sum * 100) / 100 : undefined),
      currency: o.currency ?? items[0]?.currency,
      coupon: o.coupon,
      shipping: o.shipping,
      tax: o.tax,
      item_count: items.reduce((n, p) => n + (p.quantity ?? 1), 0),
      items: items.map(productProps),
    });
  };
  api.debug = (on = true) => {
    debug = on;
  };
  api.version = VERSION;
  api.loaded = true;

  // ---------- the page: clicks, route changes, links between the owner's domains ----------
  const addParam = (href: string, value: string): string => {
    try {
      const u = new URL(href, win.location.href);
      u.searchParams.set(LINK_PARAM, value);
      return u.toString();
    } catch {
      return href;
    }
  };

  const onClick = safe((e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target?.closest) return;
    const tagged = target.closest('[data-flipper-event]');
    if (tagged) {
      track(
        tagged.getAttribute('data-flipper-event') ?? '',
        propertiesFromAttributes(Array.from(tagged.attributes)),
      );
    }
    const a = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const host = hostOf(a.href);
    const own = hostOf(win.location.href);
    if (!host || host === own) return;
    if (linkDomains.includes(host)) {
      // To another domain of the owner: the visitor goes along (only with consent).
      const id = consent === 'granted' ? identity() : null;
      if (id) a.href = addParam(a.href, id.v);
    } else if (outbound) {
      track('OutboundClick', { host, url: cleanUrl(a.href, [], false) });
    }
  });
  doc.addEventListener('click', onClick, true);

  // The visitor arriving from another domain of the owner: taken in, and the address cleaned.
  safe(() => {
    const u = new URL(win.location.href);
    const incoming = u.searchParams.get(LINK_PARAM);
    if (incoming === null) return;
    linked = incoming;
    u.searchParams.delete(LINK_PARAM);
    win.history.replaceState(win.history.state, '', u.toString());
  })();

  // Pages of a single-page site: every route change is a page view.
  if (spa && win.history) {
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = win.history[method];
      win.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
        const result = original.apply(this, args);
        setTimeout(pageview, 80);
        return result;
      };
    }
    win.addEventListener('popstate', () => setTimeout(pageview, 80));
  }

  // The events waiting in the queue are sent when the page goes away.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') safe(flush)();
  });
  win.addEventListener('pagehide', safe(flush));

  // What the page asked before the script arrived: `flipper('track', …)` through the stub.
  const stub = existing?.q ?? [];
  (win as unknown as { flipper: Flipper }).flipper = api;
  for (const call of stub) api(...Array.from(call as ArrayLike<unknown>));
  if (auto) setTimeout(pageview, 0);
  return api;
}
