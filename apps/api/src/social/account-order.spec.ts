import { describe, expect, it } from 'vitest';
import { orderAccounts } from './account-order.js';

const at = (id: string, day: number) => ({ id, createdAt: new Date(`2026-11-0${day}T00:00:00Z`) });

describe('orderAccounts', () => {
  const list = [at('pin', 1), at('etsy', 3), at('ua', 5), at('world', 6)];

  it('without a saved order: the order they were connected in', () => {
    expect(orderAccounts([list[2]!, list[0]!, list[3]!, list[1]!], []).map((a) => a.id)).toEqual([
      'pin',
      'etsy',
      'ua',
      'world',
    ]);
  });

  it('the saved order first; accounts connected since follow, oldest first', () => {
    expect(orderAccounts(list, ['world', 'ua']).map((a) => a.id)).toEqual([
      'world',
      'ua',
      'pin',
      'etsy',
    ]);
  });

  it('ids that no longer exist are ignored', () => {
    expect(orderAccounts(list, ['gone', 'etsy', 'also-gone']).map((a) => a.id)).toEqual([
      'etsy',
      'pin',
      'ua',
      'world',
    ]);
  });
});
