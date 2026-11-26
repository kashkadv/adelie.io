import { describe, expect, it } from 'vitest';
import { imageSize } from '../assets/storage.js';
import { bestState, hashWorkerKey, isWorkerKey, newWorkerKey, workerState } from '../gpu/gpu.js';
import { parseCandidateRequest, seedsFor } from './scenes.js';

const LOC = '0190f3a0-0000-7000-8000-000000000001';

describe('parseCandidateRequest', () => {
  it('accepts a full request and drops unknown product types', () => {
    const r = parseCandidateRequest({
      locationId: LOC,
      room: 'bedroom',
      style: '  warm scandinavian ',
      light: 'evening',
      angle: 'side',
      sizeClass: 'large',
      productTypes: ['rug', 'lizhnyk', 'rug', 'sofa'],
      count: 6,
    });
    expect(r).toEqual({
      ok: true,
      request: {
        locationId: LOC,
        room: 'bedroom',
        style: 'warm scandinavian',
        light: 'evening',
        angle: 'side',
        sizeClass: 'large',
        placement: 'floor',
        productTypes: ['rug', 'lizhnyk'],
        notes: '',
        count: 6,
      },
    });
  });

  it('names the wrong field', () => {
    const base = { locationId: LOC, sizeClass: 'small', productTypes: ['rug'] };
    expect(parseCandidateRequest({ ...base, locationId: 'x' })).toEqual({
      ok: false,
      error: 'locationId',
    });
    expect(parseCandidateRequest({ ...base, sizeClass: 'huge' })).toEqual({
      ok: false,
      error: 'sizeClass',
    });
    expect(parseCandidateRequest({ ...base, productTypes: [] })).toEqual({
      ok: false,
      error: 'productTypes',
    });
    expect(parseCandidateRequest({ ...base, room: 'garage' })).toEqual({
      ok: false,
      error: 'room',
    });
    expect(parseCandidateRequest({ ...base, count: 9 })).toEqual({ ok: false, error: 'count' });
    expect(parseCandidateRequest({ ...base, light: 'noon' })).toEqual({
      ok: false,
      error: 'light',
    });
  });
});

describe('seedsFor', () => {
  it('gives distinct seeds', () => {
    let i = 0;
    const seq = [0.1, 0.1, 0.2, 0.3];
    expect(seedsFor(3, () => seq[i++]!)).toHaveLength(3);
  });
});

describe('GPU worker', () => {
  it('makes keys of the expected form and hashes them', () => {
    const key = newWorkerKey();
    expect(isWorkerKey(key)).toBe(true);
    expect(isWorkerKey('fls_abc')).toBe(false);
    expect(hashWorkerKey(key)).toHaveLength(64);
  });

  it('tells ready, busy and offline apart', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    const fresh = new Date(now - 30_000);
    expect(workerState({ lastSeenAt: fresh, state: 'ready' }, now)).toBe('ready');
    expect(workerState({ lastSeenAt: fresh, state: 'busy' }, now)).toBe('busy');
    expect(workerState({ lastSeenAt: new Date(now - 120_000), state: 'ready' }, now)).toBe(
      'offline',
    );
    expect(workerState({ lastSeenAt: null, state: null }, now)).toBe('offline');
    expect(bestState(['offline', 'busy'])).toBe('busy');
    expect(bestState([])).toBe('offline');
  });
});

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(832, 16);
    png.writeUInt32BE(1248, 20);
    expect(imageSize(png)).toEqual({ width: 832, height: 1248 });
  });
});
