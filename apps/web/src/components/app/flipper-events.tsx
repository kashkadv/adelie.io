'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CodeBlock } from './flipper-guide';

type EventKey = 'viewCategory' | 'productView' | 'addToCart' | 'beginCheckout' | 'purchase';
type Need = 'required' | 'recommended' | 'optional' | 'auto';
type Tab = 'js' | 'html' | 'next';

/** The properties of each event: name, how much it matters, and a note's key. */
const PROPS: Record<EventKey, [string, Need][]> = {
  viewCategory: [
    ['category_id', 'recommended'],
    ['category_name', 'recommended'],
    ['item_count', 'auto'],
    ['items', 'optional'],
  ],
  productView: [
    ['item_id', 'required'],
    ['item_name', 'recommended'],
    ['price', 'recommended'],
    ['currency', 'recommended'],
    ['category', 'optional'],
    ['brand', 'optional'],
    ['variant', 'optional'],
  ],
  addToCart: [
    ['item_id', 'required'],
    ['item_name', 'recommended'],
    ['price', 'recommended'],
    ['currency', 'recommended'],
    ['quantity', 'optional'],
    ['value', 'auto'],
  ],
  beginCheckout: [
    ['items', 'required'],
    ['currency', 'recommended'],
    ['coupon', 'optional'],
    ['value', 'auto'],
    ['item_count', 'auto'],
  ],
  purchase: [
    ['transaction_id', 'required'],
    ['items', 'recommended'],
    ['value', 'recommended'],
    ['currency', 'recommended'],
    ['coupon', 'optional'],
    ['shipping', 'optional'],
    ['tax', 'optional'],
  ],
};

const CODE: Record<EventKey, Partial<Record<Tab, string>>> = {
  viewCategory: {
    js: `// Run it when the category page has shown its products.
flipper('viewCategory', {
  id: 'runners',              // the category's id or slug
  name: 'Runner rugs',
  items: [                    // optional: the products shown on the page
    { id: '00022503', name: 'Rug “HUK Stone”', price: 22300, currency: 'UAH' },
  ],
});`,
    next: `// components/CategoryTracking.tsx
'use client';
import { useEffect } from 'react';

export function CategoryTracking({ category, products }: { category: Category; products: Product[] }) {
  useEffect(() => {
    window.flipper?.('viewCategory', {
      id: category.slug,
      name: category.title,
      items: products.map((p) => ({ id: p.sku, name: p.title, price: p.price, currency: p.currency })),
    });
  }, [category.slug]); // once per category, not on every render
  return null;
}

// app/catalog/[slug]/page.tsx — somewhere in the page:
// <CategoryTracking category={category} products={products} />`,
  },
  productView: {
    js: `// Run it when the product page has shown the product.
// "id" is the ARTICLE — the same as g:id in your feed and the SKU in Etsy.
flipper('productView', {
  id: '00022502',
  name: 'Rug “HUK Stone”',
  price: 29000,
  currency: 'UAH',
  category: 'Rugs',
});`,
    next: `// components/ProductTracking.tsx
'use client';
import { useEffect } from 'react';

export function ProductTracking({ product }: { product: Product }) {
  useEffect(() => {
    window.flipper?.('productView', {
      id: product.sku,
      name: product.title,
      price: product.price,
      currency: product.currency,
      category: product.category,
    });
  }, [product.sku]);
  return null;
}`,
  },
  addToCart: {
    js: `// Run it AFTER the cart has accepted the product, not on the click itself.
const response = await fetch('/api/cart', { method: 'POST', body: JSON.stringify({ sku, quantity: 1 }) });
if (response.ok) {
  flipper('addToCart', { id: sku, name: title, price, currency: 'UAH' }, 1); // …, quantity
}`,
    html: `<!-- Without JavaScript: the event goes on the click. Use it only if the button always adds. -->
<button
  data-flipper-event="AddToCart"
  data-flipper-item-id="00022502"
  data-flipper-item-name="Rug HUK Stone"
  data-flipper-price="29000"
  data-flipper-currency="UAH"
  data-flipper-quantity="1"
>Add to cart</button>`,
    next: `async function onAddToCart() {
  await cart.add(product.sku, 1); // throws if the cart refuses
  window.flipper?.('addToCart', {
    id: product.sku, name: product.title, price: product.price, currency: product.currency,
  }, 1);
}`,
  },
  beginCheckout: {
    js: `// Run it when checkout starts: the cart's "Checkout" button, or the checkout page opening.
flipper('beginCheckout', {
  currency: 'UAH',
  coupon: 'WINTER10',          // optional
  items: [
    { id: '00022502', name: 'Rug “HUK Stone”', price: 29000, quantity: 1 },
    { id: '00033628', name: 'Rug', price: 3700, quantity: 2 },
  ],
});`,
    html: `<!-- The "Checkout" button: only simple values can go in attributes (no item list) -->
<button
  data-flipper-event="BeginCheckout"
  data-flipper-currency="UAH"
  data-flipper-value="36400"
>Checkout</button>`,
    next: `// app/checkout/page.tsx → a client component that runs once when the page opens
'use client';
import { useEffect } from 'react';

export function CheckoutTracking({ cart }: { cart: Cart }) {
  useEffect(() => {
    window.flipper?.('beginCheckout', {
      currency: cart.currency,
      coupon: cart.coupon,
      items: cart.lines.map((l) => ({ id: l.sku, name: l.title, price: l.price, quantity: l.qty })),
    });
  }, []);
  return null;
}`,
  },
  purchase: {
    js: `// Run it ONCE, when the order is paid: in the payment callback, or on the "thank you" page.
flipper('purchase', {
  id: 'ORD-10452',            // the order number — required
  currency: 'UAH',
  shipping: 150,
  items: [{ id: '00022502', name: 'Rug “HUK Stone”', price: 29000, quantity: 1 }],
});`,
    next: `// app/thank-you/page.tsx → a client component; guard against a page reload
'use client';
import { useEffect } from 'react';

export function PurchaseTracking({ order }: { order: Order }) {
  useEffect(() => {
    const key = 'fl_purchase_' + order.id;
    if (sessionStorage.getItem(key)) return; // already sent
    sessionStorage.setItem(key, '1');
    window.flipper?.('purchase', {
      id: order.id,
      currency: order.currency,
      items: order.lines.map((l) => ({ id: l.sku, name: l.title, price: l.price, quantity: l.qty })),
    });
  }, []);
  return null;
}`,
  },
};

const NEED_STYLE: Record<Need, string> = {
  required: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  recommended: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  optional: 'bg-hover text-muted',
  auto: 'bg-hover text-muted',
};

/** One event in detail: when it fires, what it carries, how to send it, how to check it. */
function EventCard({ id }: { id: EventKey }) {
  const t = useTranslations('Flipper.guide.events');
  const tabs = (['js', 'html', 'next'] as Tab[]).filter((k) => CODE[id][k]);
  const [tab, setTab] = useState<Tab>('js');
  const code = CODE[id][tab] ?? CODE[id].js!;
  return (
    <article className="rounded-2xl border border-line p-4">
      <h4 className="flex flex-wrap items-baseline gap-x-3 text-foreground">
        <span className="font-display text-base font-semibold">{t(`cards.${id}.title`)}</span>
        <code className="text-xs text-muted">{t(`names.${id}`)}</code>
      </h4>
      <p className="mt-1">{t(`cards.${id}.when`)}</p>

      <p className="mt-4 mb-1.5 text-xs font-semibold text-foreground">{t('propsTitle')}</p>
      <ul className="grid gap-1.5">
        {PROPS[id].map(([name, need]) => (
          <li key={name} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <code className="text-xs text-foreground">{name}</code>
            <span className={`rounded-full px-1.5 text-[11px] leading-4 ${NEED_STYLE[need]}`}>
              {t(`needs.${need}`)}
            </span>
            <span className="min-w-0 flex-1 basis-60">{t(`props.${name}` as 'props.item_id')}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 mb-1.5 text-xs font-semibold text-foreground">{t('howTitle')}</p>
      <ol className="grid list-decimal gap-1 pl-5">
        {(['step1', 'step2', 'step3'] as const).map((s) => (
          <li key={s}>{t(`cards.${id}.${s}`)}</li>
        ))}
      </ol>

      <div className="mt-4 mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label={t('codeTitle')}>
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              tab === k
                ? 'border-transparent bg-accent text-accent-foreground'
                : 'border-line hover:text-foreground'
            }`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <CodeBlock code={code} />
      {tab === 'html' && <p className="mt-2 text-xs">{t('htmlNote')}</p>}

      <p className="mt-4 mb-1 text-xs font-semibold text-foreground">{t('mistakesTitle')}</p>
      <ul className="grid list-disc gap-1 pl-5">
        {(['mistake1', 'mistake2'] as const).map((m) => (
          <li key={m}>{t(`cards.${id}.${m}`)}</li>
        ))}
      </ul>

      <p className="mt-4 rounded-xl bg-hover px-3 py-2 text-xs">
        <span className="font-semibold text-foreground">{t('testTitle')}: </span>
        {t(`cards.${id}.test`)}
      </p>
    </article>
  );
}

/** The four shop events, in the order a buyer goes through them. */
export function EventCards() {
  return (
    <div className="grid gap-4">
      {(['viewCategory', 'productView', 'addToCart', 'beginCheckout', 'purchase'] as const).map(
        (id) => (
          <EventCard key={id} id={id} />
        ),
      )}
    </div>
  );
}

/** The recipe for sites that cannot be edited: Google Tag Manager carries the script and events. */
export const GTM_INSTALL = `<!-- Tag: Custom HTML · name "Flipper — install" · trigger: All Pages -->
<script>window.flipper=window.flipper||function(){(window.flipper.q=window.flipper.q||[]).push(arguments)}</script>
<script async src="SCRIPT_URL" data-site-id="SITE_ID"></script>`;

export const GTM_PRODUCT = `<!-- Tag: Custom HTML · "Flipper — product view"
     Trigger: Page View · Page Path matches RegEx  ^/product/ -->
<script>
  var m = location.pathname.match(/\\/product\\/(?:[^\\/]+\\/)?(\\d+)/); // /product/slug/00022502 or /product/00022502
  if (m) flipper('productView', { id: m[1], name: document.title });
</script>`;

export const GTM_CART = `<!-- Tag: Custom HTML · "Flipper — add to cart"
     Trigger: Click · All Elements · Click Element matches CSS selector  .add-to-cart, .add-to-cart *
     Variable "Click Element": built in (enable it under Variables) -->
<script>
  var el = {{Click Element}}.closest('[data-sku]');
  if (el) flipper('addToCart', { id: el.getAttribute('data-sku'), price: Number(el.getAttribute('data-price')) || undefined });
</script>`;
