import { describe, expect, it } from 'vitest';
import {
  breakdown,
  dailyMetric,
  dailySeries,
  periods,
  snapshotMetric,
  type StoredValue,
} from './aggregate.js';

const v = (p: Partial<StoredValue>): StoredValue => ({
  accountId: 'a1',
  key: 'impressions',
  date: '2026-11-06',
  dimensionKey: '',
  value: 1,
  dataStatus: 'READY',
  ...p,
});

describe('periods', () => {
  it('current ends today, previous is the same length right before', () => {
    expect(periods(7, '2026-11-06')).toEqual({
      current: { from: '2026-10-31', to: '2026-11-06', days: 7 },
      previous: { from: '2026-10-24', to: '2026-10-30', days: 7 },
    });
  });
});

describe('dailyMetric', () => {
  const { current, previous } = periods(3, '2026-11-06');

  it('sums days across accounts, compares with the previous period, worst status wins', () => {
    const values = [
      v({ date: '2026-11-04', value: 10 }),
      v({ date: '2026-11-05', value: 5, accountId: 'a2' }),
      v({ date: '2026-11-06', value: 2, dataStatus: 'PROCESSING' }),
      v({ date: '2026-11-02', value: 4 }), // previous period
      v({ date: '2026-11-05', value: 999, dimensionKey: 'app_type=WEB' }), // breakdown, ignored
    ];
    expect(dailyMetric(values, 'impressions', current, previous)).toEqual({
      value: 17,
      previous: 4,
      status: 'PROCESSING',
      coverage: 1,
    });
  });

  it('missing data is null, never zero; coverage counts days with data', () => {
    const values = [
      v({ date: '2026-11-04', value: null, dataStatus: 'UNAVAILABLE' }),
      v({ date: '2026-11-05', value: 3 }),
    ];
    expect(dailyMetric(values, 'impressions', current, previous)).toEqual({
      value: 3,
      previous: null,
      status: 'READY',
      coverage: 1 / 3,
    });
    expect(dailyMetric([], 'impressions', current, previous)).toEqual({
      value: null,
      previous: null,
      status: 'UNAVAILABLE',
      coverage: 0,
    });
  });
});

describe('snapshotMetric', () => {
  it('latest value at the period end per account, summed', () => {
    const { current, previous } = periods(7, '2026-11-06');
    const values = [
      v({ key: 'followers', date: '2026-10-20', value: 40 }),
      v({ key: 'followers', date: '2026-11-06', value: 45 }),
      v({ key: 'followers', date: '2026-11-01', value: 10, accountId: 'a2' }),
    ];
    expect(snapshotMetric(values, 'followers', current, previous)).toEqual({
      value: 55,
      previous: 40,
      status: 'READY',
      coverage: 1,
    });
  });
});

describe('dailySeries & breakdown', () => {
  const { current } = periods(3, '2026-11-06');

  it('one point per day; days without data are null (a gap, not zero)', () => {
    const values = [
      v({ date: '2026-11-04', value: 3 }),
      v({ date: '2026-11-04', value: 2, accountId: 'a2' }),
    ];
    expect(dailySeries(values, 'impressions', current)).toEqual([
      { date: '2026-11-04', value: 5, status: 'READY' },
      { date: '2026-11-05', value: null, status: 'UNAVAILABLE' },
      { date: '2026-11-06', value: null, status: 'UNAVAILABLE' },
    ]);
  });

  it('breakdown by app_type, largest first', () => {
    const values = [
      v({ dimensionKey: 'app_type=WEB', value: 3 }),
      v({ dimensionKey: 'app_type=MOBILE', value: 5 }),
      v({ dimensionKey: 'app_type=WEB', value: 4, date: '2026-11-05' }),
      v({ value: 100 }), // totals, ignored
    ];
    expect(breakdown(values, 'impressions', 'app_type', current)).toEqual([
      { key: 'WEB', value: 7 },
      { key: 'MOBILE', value: 5 },
    ]);
  });
});
