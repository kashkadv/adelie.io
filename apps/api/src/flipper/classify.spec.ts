import { describe, expect, it } from 'vitest';
import { classifyVisit } from './classify.js';

const visit = (landing: string, referrer = '', ownHost = 'gushka.ua') =>
  classifyVisit({ landing, referrer, ownHost });
const L = 'https://gushka.ua/p/1';

describe('classifyVisit — labels', () => {
  it('a post of Pinterest: source, medium, campaign and content kept apart', () => {
    expect(
      visit(
        `${L}?utm_source=pinterest&utm_medium=organic_social&utm_campaign=winter_collection&utm_content=pin_123`,
      ),
    ).toMatchObject({
      source: 'pinterest',
      medium: 'organic_social',
      campaign: 'winter_collection',
      content: 'pin_123',
      channel: 'Organic Social',
    });
  });

  it('values are lower-cased and trimmed', () => {
    expect(visit(`${L}?utm_source=Pinterest&utm_medium=Organic_Social`)).toMatchObject({
      source: 'pinterest',
      channel: 'Organic Social',
    });
  });

  it.each([
    ['instagram', 'paid_social', 'Paid Social'],
    ['facebook', 'cpc', 'Paid Social'],
    ['google', 'cpc', 'Paid Search'],
    ['google', 'organic', 'Organic Search'],
    ['newsletter', 'email', 'Email'],
    ['partner', 'affiliate', 'Affiliate'],
    ['ads', 'display', 'Display'],
    ['blog', 'referral', 'Referral'],
    ['something', 'whatever', 'Other'],
  ])('%s / %s → %s', (source, medium, channel) => {
    expect(visit(`${L}?utm_source=${source}&utm_medium=${medium}`).channel).toBe(channel);
  });

  it('a social source without a medium is organic social', () => {
    expect(visit(`${L}?utm_source=tiktok`).channel).toBe('Organic Social');
  });
});

describe('classifyVisit — click ids', () => {
  it('epik (Pinterest) and fbclid say where the click came from', () => {
    expect(visit(`${L}?epik=abc`)).toMatchObject({
      source: 'pinterest',
      clickIdType: 'epik',
      channel: 'Organic Social',
    });
    expect(visit(`${L}?fbclid=abc`)).toMatchObject({
      source: 'facebook',
      clickIdType: 'fbclid',
      channel: 'Organic Social',
    });
  });

  it('the click ids of ad platforms mean an ad', () => {
    expect(visit(`${L}?gclid=abc`)).toMatchObject({
      source: 'google',
      medium: 'cpc',
      channel: 'Paid Search',
    });
    expect(visit(`${L}?ttclid=abc`)).toMatchObject({ source: 'tiktok', channel: 'Paid Social' });
  });

  it('labels win over a click id', () => {
    expect(visit(`${L}?utm_source=newsletter&utm_medium=email&fbclid=x`)).toMatchObject({
      source: 'newsletter',
      channel: 'Email',
      clickIdType: 'fbclid',
    });
  });
});

describe('classifyVisit — the referrer', () => {
  it('a search engine', () => {
    expect(visit(L, 'https://www.google.com.ua/')).toMatchObject({
      source: 'google',
      medium: 'organic',
      channel: 'Organic Search',
    });
    expect(visit(L, 'https://duckduckgo.com/')).toMatchObject({ channel: 'Organic Search' });
  });

  it('a social network', () => {
    expect(visit(L, 'https://l.instagram.com/?u=x')).toMatchObject({
      source: 'instagram',
      medium: 'social',
      channel: 'Organic Social',
    });
    expect(visit(L, 'https://www.pinterest.com/')).toMatchObject({
      source: 'pinterest',
      channel: 'Organic Social',
    });
    expect(visit(L, 'https://pin.it/abc')).toMatchObject({ source: 'pinterest' });
  });

  it('another site is a referral, with its host kept', () => {
    expect(visit(L, 'https://blog.example.org/post')).toMatchObject({
      source: 'blog.example.org',
      medium: 'referral',
      channel: 'Referral',
      referrerHost: 'blog.example.org',
    });
  });

  it('the site’s own host is not a source: nothing else — direct', () => {
    expect(visit(L, 'https://www.gushka.ua/catalog')).toMatchObject({
      channel: 'Direct',
      referrerHost: null,
    });
    expect(visit(L)).toMatchObject({ channel: 'Direct', source: null });
  });

  it('a junk referrer or landing address does not break it', () => {
    expect(classifyVisit({ landing: 'nope', referrer: 'also nope' }).channel).toBe('Direct');
  });
});
