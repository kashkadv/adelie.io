import { describe, expect, it } from 'vitest';
import { productLinkKey } from './links.js';

describe('productLinkKey', () => {
  it('finds the Etsy listing in listing and shop links', () => {
    expect(productLinkKey('https://www.etsy.com/ca/listing/913041795/handmade-ceramic')).toBe(
      'etsy:913041795',
    );
    expect(productLinkKey('https://etsy.com/listing/42')).toBe('etsy:42');
    expect(
      productLinkKey(
        'https://www.etsy.com/shop/GushkaWoolRugs?ref=simple-shop-header-name&listing_id=970303955&page=2#items',
      ),
    ).toBe('etsy:970303955');
  });

  it('a shop page without a listing, other sites and junk point to no product', () => {
    expect(
      productLinkKey('https://www.etsy.com/shop/GushkaWoolRugs?ref=search_shop_redirect'),
    ).toBeNull();
    expect(productLinkKey('https://gushka.ua/rugs/1')).toBeNull();
    expect(productLinkKey('not a url')).toBeNull();
    expect(productLinkKey(null)).toBeNull();
  });
});
