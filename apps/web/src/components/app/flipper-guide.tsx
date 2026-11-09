'use client';

import { EventCards } from './flipper-events';

import { Check, ChevronDown, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** The two lines that put Flipper on a page: a stub (calls made early are kept) and the script. */
export const installSnippet = (scriptUrl: string, siteId: string, options = '') =>
  `<script>window.flipper=window.flipper||function(){(window.flipper.q=window.flipper.q||[]).push(arguments)}</script>
<script async src="${scriptUrl}" data-site-id="${siteId}"${options}></script>`;

/** A code block with a copy button. Code is code: its comments are in English everywhere. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const t = useTranslations('Flipper');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // the text stays selectable
    }
  }
  const icon = copied ? (
    <Check size={13} aria-hidden="true" />
  ) : (
    <Copy size={13} aria-hidden="true" />
  );
  const buttonClass =
    'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-[var(--card,transparent)] px-2.5 py-1 text-xs text-muted hover:text-foreground';
  // One line (an address, a key): text and button share a row, so they are centred together.
  if (!code.includes('\n')) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-hover px-4 py-3">
        <pre
          aria-label={label}
          className="scroll-thin min-w-0 flex-1 overflow-x-auto py-0.5 text-xs leading-none"
        >
          <code>{code}</code>
        </pre>
        <button type="button" onClick={copy} className={buttonClass}>
          {icon}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <pre
        aria-label={label}
        className="scroll-thin overflow-x-auto rounded-2xl bg-hover p-4 pr-24 text-xs leading-relaxed"
      >
        <code>{code}</code>
      </pre>
      <button type="button" onClick={copy} className={`absolute top-2.5 right-2.5 ${buttonClass}`}>
        {icon}
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}

const ATTRIBUTES = `<!-- No JavaScript needed: data-flipper-* on the element fires the event on click -->
<button
  data-flipper-event="AddToCart"
  data-flipper-item-id="00022502"
  data-flipper-item-name="Rug HUK Stone"
  data-flipper-price="29000"
  data-flipper-currency="UAH"
  data-flipper-quantity="1"
>Add to cart</button>`;

const NEXT = `// app/layout.tsx (Next.js): one place, every page; each domain has its own id.
// The mode (full / anonymous) is set in the cabinet and travels with the script.
import Script from 'next/script';
import { headers } from 'next/headers';

const SITES = {
  'gushka.ua': 'fl_UA_SITE_ID',
  'gushka.world': 'fl_WORLD_SITE_ID',
} as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = ((await headers()).get('host') ?? 'gushka.ua').replace(/^www\\./, '') as keyof typeof SITES;
  const id = SITES[host] ?? SITES['gushka.ua'];
  return (
    <html>
      <body>
        {children}
        <Script id="flipper-stub" strategy="afterInteractive">{
          "window.flipper=window.flipper||function(){(window.flipper.q=window.flipper.q||[]).push(arguments)}"
        }</Script>
        <Script
          src={\`https://dev-api.adelie.space/flipper.js?site=\${id}\`}
          data-site-id={id}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;

const SERVER = `// On your server, when the payment is confirmed (webhook, poll or cron — repeats are safe).
await fetch('__API__/collect/server', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: \`Bearer \${process.env.FLIPPER_SERVER_KEY}\`, // keep the key on the server only
  },
  body: JSON.stringify({
    transaction_id: order.number,          // required — one order is one purchase
    occurred_at: order.paidAt.toISOString(), // when it was paid, not when you send it (up to 7 days back)
    visitor_id: order.flVisitorId,         // the _fl_v cookie saved when the order was created
    value: order.total,
    currency: 'UAH',
    shipping: order.shipping,
    items: order.lines.map((l) => ({ item_id: l.sku, item_name: l.title, price: l.price, quantity: l.qty })),
  }),
});
// → { "status": "created" | "duplicate", "attributed": true | false }`;

const NEXT_EVENTS = `// A product page (client component): once when the product is shown
'use client';
import { useEffect } from 'react';

export function ProductTracking({ product }: { product: Product }) {
  useEffect(() => {
    window.flipper?.('productView', {
      id: product.sku, name: product.title, price: product.price, currency: product.currency,
    });
  }, [product.sku]);
  return null;
}

// The "Add to cart" handler: after the cart accepted the product
async function onAddToCart() {
  await cart.add(product.sku, 1);
  window.flipper?.('addToCart', { id: product.sku, price: product.price, currency: product.currency }, 1);
}`;

const CONSENT = `// Your cookie banner decides. Until then Flipper counts visits without storing anything.
function onConsentChanged(allowed: boolean) {
  window.flipper?.('consent', allowed ? 'granted' : 'denied');
}
// On every page load, with the choice the visitor made earlier:
if (savedChoice === 'granted') window.flipper?.('consent', 'granted');`;

const TYPES = `// Optional: types for TypeScript (global.d.ts)
declare global {
  interface Window {
    flipper?: (command: string, ...args: unknown[]) => void;
  }
}
export {};`;

/** The guide to putting Flipper on a site and tagging its shop events (ADR-0022). */
export function FlipperGuide({ scriptUrl, siteId }: { scriptUrl: string; siteId: string }) {
  const t = useTranslations('Flipper.guide');
  const [open, setOpen] = useState<string | null>('install');

  const section = (id: string, title: string, children: React.ReactNode) => (
    <section className="border-b border-line last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open === id}
          onClick={() => setOpen(open === id ? null : id)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold"
        >
          {title}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open === id ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      {open === id && <div className="grid gap-4 px-5 pb-5 text-sm text-muted">{children}</div>}
    </section>
  );

  const p = (key: string, values?: Record<string, string>) => (
    <p className="leading-relaxed">{t(key as 'install.lead', values)}</p>
  );

  return (
    <div className="card animate-rise overflow-hidden rounded-[24px]">
      {section(
        'install',
        t('install.title'),
        <>
          {p('install.lead')}
          <CodeBlock code={installSnippet(scriptUrl, siteId)} />
          {p('install.next')}
          <CodeBlock code={NEXT} />
          {p('install.options')}
        </>,
      )}
      {section(
        'consent',
        t('consent.title'),
        <>
          {p('consent.lead')}
          <CodeBlock code={CONSENT} />
          {p('consent.dnt')}
        </>,
      )}
      {section(
        'events',
        t('events.title'),
        <>
          {p('events.lead')}
          {p('events.ga4')}
          <ul className="grid gap-2">
            {(
              ['viewCategory', 'productView', 'addToCart', 'beginCheckout', 'purchase'] as const
            ).map((k) => (
              <li key={k} className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{t(`events.names.${k}`)}</span>
                <span>{t(`events.when.${k}`)}</span>
              </li>
            ))}
          </ul>
          <EventCards />
          {p('events.next')}
          <CodeBlock code={NEXT_EVENTS} />
          {p('events.types')}
          <CodeBlock code={TYPES} />
        </>,
      )}
      {section(
        'attributes',
        t('attributes.title'),
        <>
          {p('attributes.lead')}
          <CodeBlock code={ATTRIBUTES} />
          {p('attributes.note')}
        </>,
      )}
      {section(
        'domains',
        t('domains.title'),
        <>
          {p('domains.lead')}
          {p('domains.geo')}
        </>,
      )}
      {section(
        'sources',
        t('sources.title'),
        <>
          {p('sources.lead')}
          <CodeBlock
            code={`https://gushka.ua/product/00022502
  ?utm_source=pinterest
  &utm_medium=organic_social
  &utm_campaign=winter_collection
  &utm_content=pin_123`}
          />
          {p('sources.rules')}
        </>,
      )}
      {section(
        'server',
        t('server.title'),
        <>
          {p('server.lead')}
          <CodeBlock code={SERVER.replace('__API__', scriptUrl.replace(/\/flipper\.js.*$/, ''))} />
          {p('server.after')}
        </>,
      )}
      {section(
        'check',
        t('check.title'),
        <>
          {p('check.lead')}
          <CodeBlock code={`https://gushka.ua/product/00022502?flipper_debug=1`} />
          {p('check.problems')}
        </>,
      )}
    </div>
  );
}
