// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://gushka.ua/product/00022502?utm_source=pinterest&utm_medium=organic_social&email=a@b.c"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, type Flipper } from './runtime.js';

type Body = {
  s: string;
  c: number;
  v?: string;
  ss?: string;
  a?: { l: string; r: string };
  e: { n: string; p: Record<string, unknown>; u: string; a?: { l: string; r: string } }[];
};

let sent: string[] = [];

function load(attrs: Record<string, string> = {}): Flipper | null {
  document.querySelectorAll('script[data-site-id]').forEach((s) => s.remove());
  const script = document.createElement('script');
  script.src = 'https://dev-api.adelie.space/flipper.js';
  script.setAttribute('data-site-id', 'fl_test');
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(`data-${k}`, v);
  document.head.append(script);
  return init({ win: window as never, doc: document, script });
}

const bodies = (): Body[] => sent.map((s) => JSON.parse(s) as Body);
const clearCookies = () =>
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]!.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

// Every test loads the script anew on the same page: what the previous one hooked into the page
// (history methods, listeners) is taken back, so tests do not hear each other.
const original = { push: window.history.pushState, replace: window.history.replaceState };
const listeners: [EventTarget, string, EventListenerOrEventListenerObject, unknown][] = [];
for (const target of [document, window] as EventTarget[]) {
  const add = target.addEventListener.bind(target);
  target.addEventListener = ((
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: unknown,
  ) => {
    listeners.push([target, type, fn, opts]);
    add(type, fn, opts as never);
  }) as typeof target.addEventListener;
}

beforeEach(() => {
  for (const [target, type, fn, opts] of listeners.splice(0))
    target.removeEventListener(type, fn, opts as never);
  window.history.pushState = original.push;
  window.history.replaceState = original.replace;
  vi.useFakeTimers();
  sent = [];
  clearCookies();
  delete (window as unknown as { flipper?: unknown }).flipper;
  window.history.replaceState(
    {},
    '',
    '/product/00022502?utm_source=pinterest&utm_medium=organic_social&email=a@b.c',
  );
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_url: string, blob: Blob) => {
      // jsdom's Blob has no text(): read what the test put in
      (blob as unknown as { _body?: string })._body;
      sent.push(blobText.get(blob) ?? '');
      return true;
    },
  });
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
});
afterEach(() => vi.useRealTimers());

// jsdom cannot read a Blob synchronously: remember what each one was made of.
const blobText = new WeakMap<Blob, string>();
const RealBlob = globalThis.Blob;
globalThis.Blob = class extends RealBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    blobText.set(this, (parts ?? []).join(''));
  }
} as typeof Blob;

describe('without consent', () => {
  it('sends the page view anonymously and stores nothing in the browser', () => {
    load();
    vi.advanceTimersByTime(2000);
    expect(document.cookie).toBe('');
    const [b] = bodies();
    expect(b).toMatchObject({ s: 'fl_test', c: 0 });
    expect(b!.v).toBeUndefined();
    expect(b!.ss).toBeUndefined();
    const e = b!.e[0]!;
    expect(e.n).toBe('PageView');
    // the address is cleaned: the email is gone, the campaign stays
    expect(e.u).toBe(
      'https://gushka.ua/product/00022502?utm_source=pinterest&utm_medium=organic_social',
    );
    // an arrival (a campaign address) carries where it came from
    expect(e.a?.l).toContain('utm_source=pinterest');
  });

  it('a Do Not Track browser sends nothing at all', () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    load();
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
  });

  it('after "denied" nothing goes out', () => {
    const f = load({ 'auto-pageview': 'false' })!;
    f.consent('denied');
    f.track('AddToCart');
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
  });
});

describe('with consent', () => {
  it('has a visitor and a session, and the attribution the session began with', () => {
    load({ consent: 'granted' });
    vi.advanceTimersByTime(2000);
    const [b] = bodies();
    expect(b!.c).toBe(1);
    expect(b!.v).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.ss).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.a?.l).toContain('utm_source=pinterest');
    expect(document.cookie).toContain('_fl_v=');
  });

  it('the same visitor and session on the next page; the attribution does not change', () => {
    const f = load({ consent: 'granted' })!;
    vi.advanceTimersByTime(2000);
    window.history.replaceState({}, '', '/catalog');
    f.track('ViewCategory', { category_name: 'Rugs' });
    vi.advanceTimersByTime(2000);
    const [first, second] = bodies();
    expect(second!.v).toBe(first!.v);
    expect(second!.ss).toBe(first!.ss);
    expect(second!.a?.l).toContain('utm_source=pinterest');
  });

  it('"granted" given later switches the mode on, and what waited goes out as it was', () => {
    const f = load({ 'auto-pageview': 'false' })!;
    f.track('PageView');
    f.consent('granted');
    f.track('AddToCart', { item_id: 'x' });
    vi.advanceTimersByTime(2000);
    const [anon, full] = bodies();
    expect(anon!.c).toBe(0);
    expect(full!.c).toBe(1);
  });
});

describe('events', () => {
  it('the helpers send the standard events with their properties', () => {
    const f = load({ 'auto-pageview': 'false' })!;
    f.viewCategory({ id: 'rugs', name: 'Rugs', items: [{ id: 1, name: 'A', price: 10 }] });
    f.productView({ id: '00022502', name: 'Rug', price: 290, currency: 'UAH' });
    f.addToCart({ id: '00022502', price: 290, currency: 'UAH' }, 2);
    f.beginCheckout({
      items: [
        { id: '1', price: 10, quantity: 2 },
        { id: '2', price: 5 },
      ],
      currency: 'USD',
    });
    vi.advanceTimersByTime(2000);
    const events = bodies().flatMap((b) => b.e);
    expect(events.map((e) => e.n)).toEqual([
      'ViewCategory',
      'ProductView',
      'AddToCart',
      'BeginCheckout',
    ]);
    expect(events[2]!.p).toMatchObject({ item_id: '00022502', quantity: 2, value: 580 });
    expect(events[3]!.p).toMatchObject({ value: 25, item_count: 3, currency: 'USD' });
  });

  it('data-flipper-event on an element fires on click, with its data-flipper-* properties', () => {
    load({ 'auto-pageview': 'false' });
    document.body.innerHTML =
      '<button id="b" data-flipper-event="AddToCart" data-flipper-product-id="7" data-flipper-price="29.9">Add</button>';
    document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    const e = bodies()[0]!.e[0]!;
    expect(e.n).toBe('AddToCart');
    expect(e.p).toEqual({ product_id: 7, price: 29.9 });
  });

  it('a link to another site is an outbound click', () => {
    load({ 'auto-pageview': 'false' });
    document.body.innerHTML = '<a id="l" href="https://etsy.com/listing/1?ref=x">Etsy</a>';
    document
      .getElementById('l')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(2000);
    const e = bodies()[0]!.e[0]!;
    expect(e.n).toBe('OutboundClick');
    expect(e.p).toEqual({ host: 'etsy.com', url: 'https://etsy.com/listing/1' });
  });

  it('a route change of a single-page site is a page view', () => {
    load({ 'auto-pageview': 'false' });
    window.history.pushState({}, '', '/catalog/rugs');
    vi.advanceTimersByTime(2000);
    const e = bodies()[0]!.e[0]!;
    expect(e.n).toBe('PageView');
    expect(e.u).toBe('https://gushka.ua/catalog/rugs');
  });

  it('what the page asked before the script came (the stub) is not lost', () => {
    (window as unknown as { flipper: unknown }).flipper = Object.assign(() => undefined, {
      q: [['track', 'Early', { x: 1 }]],
    });
    load({ 'auto-pageview': 'false' });
    vi.advanceTimersByTime(2000);
    expect(bodies()[0]!.e[0]).toMatchObject({ n: 'Early', p: { x: 1 } });
  });

  it('a wrong event name is ignored, and the script never throws', () => {
    const f = load({ 'auto-pageview': 'false' })!;
    expect(() => {
      f.track('bad name!');
      f.track(undefined as never);
      (f as unknown as (c: string) => void)('nonsense');
    }).not.toThrow();
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
  });
});

describe('two domains', () => {
  it('a link to the owner’s other domain carries the visitor, which is taken in over there', () => {
    const f = load({
      consent: 'granted',
      'link-domains': 'gushka.world',
      'auto-pageview': 'false',
    })!;
    f.pageview();
    vi.advanceTimersByTime(2000);
    const visitor = bodies()[0]!.v!;
    document.body.innerHTML = '<a id="l" href="https://gushka.world/en">World</a>';
    const link = document.getElementById('l') as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(new URL(link.href).searchParams.get('_fl')).toBe(visitor);

    // …on the other domain: the id arrives in the address, is adopted and the address is cleaned
    clearCookies();
    delete (window as unknown as { flipper?: unknown }).flipper;
    sent = [];
    window.history.replaceState({}, '', `/en?_fl=${visitor}`);
    load({ consent: 'granted', 'link-domains': 'gushka.ua' });
    vi.advanceTimersByTime(2000);
    expect(bodies()[0]!.v).toBe(visitor);
    expect(window.location.search).toBe('');
  });
});
