import { describe, expect, it } from 'vitest';
import { classifyVisit } from '../flipper/classify.js';
import {
  buildLinkUrl,
  channelOf,
  isLinkCode,
  newLinkCode,
  normaliseLabel,
  parseDestination,
  parseLinkInput,
} from './links.js';
import { parseClick, secretMatches } from './clicks.js';

describe('labels', () => {
  it('normalise the way Flipper reads them back', () => {
    expect(normaliseLabel('  Winter Sale 2026 ')).toBe('winter-sale-2026');
    expect(normaliseLabel('Зимова колекція!')).toBe('зимова-колекція');
    expect(normaliseLabel('a&b=c')).toBe('abc');
    expect(normaliseLabel(42)).toBe('');
  });

  it('codes are 7 characters a-z0-9', () => {
    const code = newLinkCode();
    expect(isLinkCode(code)).toBe(true);
    expect(isLinkCode('ABCDEFG')).toBe(false);
  });

  it('a stored link knows its channel', () => {
    expect(channelOf('instagram', 'social')).toBe('instagram');
    expect(channelOf('forum.scssoft.com', 'referral')).toBe('other');
  });
});

describe('the full address', () => {
  it('keeps the destination’s parameters and replaces its old labels', () => {
    expect(
      buildLinkUrl('https://gushka.ua/shop?color=blue&utm_source=old#reviews', {
        source: 'instagram',
        medium: 'social',
        campaign: 'winter',
        content: 'bio',
      }),
    ).toBe(
      'https://gushka.ua/shop?color=blue&utm_source=instagram&utm_medium=social&utm_campaign=winter&utm_content=bio#reviews',
    );
  });

  it('Flipper reads it as the link’s channel and labels', () => {
    const url = buildLinkUrl('https://gushka.ua/', {
      source: 'instagram',
      medium: 'social',
      campaign: 'зимова-колекція',
      content: 'k7f2abq',
    });
    expect(classifyVisit({ landing: url })).toMatchObject({
      source: 'instagram',
      medium: 'social',
      campaign: 'зимова-колекція',
      content: 'k7f2abq',
      channel: 'Organic Social',
    });
  });

  it('only http(s) destinations with a real host', () => {
    expect(parseDestination('javascript:alert(1)')).toBeNull();
    expect(parseDestination('https://localhost/x')).toBeNull();
    expect(parseDestination('https://user:pw@gushka.ua/')).toBeNull();
    expect(parseDestination('https://www.etsy.com/shop/GushkaWoolRugs')?.hostname).toBe(
      'www.etsy.com',
    );
  });
});

describe('input', () => {
  it('fills the place with the code and takes the channel’s labels', () => {
    expect(
      parseLinkInput(
        { destination: 'https://gushka.ua/', channel: 'pinterest', campaign: 'Winter' },
        'abc1234',
      ),
    ).toMatchObject({
      ok: true,
      name: null,
      labels: { source: 'pinterest', medium: 'social', campaign: 'winter', content: 'abc1234' },
    });
  });

  it('another channel needs its source', () => {
    expect(
      parseLinkInput({ destination: 'https://gushka.ua/', channel: 'other' }, 'abc1234'),
    ).toEqual({ ok: false, error: 'source' });
    expect(
      parseLinkInput(
        { destination: 'https://gushka.ua/', channel: 'other', source: 'SCS Forum' },
        'abc1234',
      ),
    ).toMatchObject({ ok: true, labels: { source: 'scs-forum', medium: 'referral' } });
    expect(parseLinkInput({ destination: 'https://gushka.ua/', channel: 'myspace' }, 'x')).toEqual({
      ok: false,
      error: 'channel',
    });
  });
});

describe('clicks', () => {
  const now = new Date('2026-11-13T10:00:00Z');
  it('keep the device class, the referrer host and the country — not the browser', () => {
    expect(
      parseClick(
        {
          code: 'abc1234',
          at: now.getTime() - 1000,
          ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Instagram',
          referrer: 'https://l.instagram.com/?u=x',
          country: 'UA',
        },
        now,
      ),
    ).toEqual({
      code: 'abc1234',
      occurredAt: new Date(now.getTime() - 1000),
      referrerHost: 'l.instagram.com',
      country: 'UA',
      device: 'mobile',
      isBot: false,
    });
  });

  it('link previews are bots; bad codes and far-off times are not trusted', () => {
    expect(parseClick({ code: 'abc1234', ua: 'WhatsApp/2.23.20.0' }, now)?.isBot).toBe(true);
    expect(parseClick({ code: 'abc1234', ua: 'Pinterestbot/1.0' }, now)?.isBot).toBe(true);
    expect(parseClick({ code: '../etc' }, now)).toBeNull();
    expect(parseClick({ code: 'abc1234', at: 0, ua: 'x' }, now)?.occurredAt).toEqual(now);
  });

  it('the Worker’s secret must match', () => {
    expect(secretMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(secretMatches('Bearer wrong', 's3cret')).toBe(false);
    expect(secretMatches('Bearer s3cret', undefined)).toBe(false);
  });
});
