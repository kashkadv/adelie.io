import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from './errors.js';
import { HttpClient, HttpStatusError, type RecordedResponse } from './http.js';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** fetch stub that replays the given responses in order and records requests. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift();
    if (!r) throw new Error('no more replies');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function client(replies: Reply[], extra: { record?: (r: RecordedResponse) => void } = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const f = fakeFetch(replies);
  const http = new HttpClient({
    baseUrl: 'https://api.example.com',
    fetch: f.fn,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    ...extra,
  });
  return { http, calls: f.calls, sleeps };
}

describe('HttpClient', () => {
  it('builds the URL with query params and returns the JSON body', async () => {
    const { http, calls } = client([{ status: 200, body: { ok: true } }]);
    const res = await http.request({
      path: '/v5/pins',
      query: { page_size: 100, bookmark: undefined },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(calls[0]!.url).toBe('https://api.example.com/v5/pins?page_size=100');
  });

  it('records response bodies but never request headers, and skips sensitive calls', async () => {
    const recorded: RecordedResponse[] = [];
    const { http } = client(
      [
        { status: 200, body: { items: [] } },
        { status: 200, body: { access_token: 'secret' } },
      ],
      { record: (r) => void recorded.push(r) },
    );
    await http.request({ path: '/v5/pins', headers: { Authorization: 'Bearer secret' } });
    await http.request({
      path: '/v5/oauth/token',
      method: 'POST',
      form: { code: 'x' },
      sensitive: true,
    });
    expect(recorded).toHaveLength(1);
    expect(JSON.stringify(recorded[0])).not.toContain('secret');
    expect(recorded[0]).toMatchObject({ endpoint: '/v5/pins', httpStatus: 200 });
  });

  it('waits for the bucket reset when the last response exhausted the quota', async () => {
    const { http, sleeps } = client([
      {
        status: 200,
        body: {},
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '7' },
      },
      { status: 200, body: {} },
    ]);
    await http.request({ path: '/a', bucket: 'analytics' });
    await http.request({ path: '/b', bucket: 'analytics' });
    expect(sleeps).toEqual([7000]);
  });

  it('keeps buckets independent', async () => {
    const { http, sleeps } = client([
      {
        status: 200,
        body: {},
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '7' },
      },
      { status: 200, body: {} },
    ]);
    await http.request({ path: '/a', bucket: 'analytics' });
    await http.request({ path: '/b', bucket: 'read' });
    expect(sleeps).toEqual([]);
  });

  it('retries 429 after Retry-After, then gives up with RATE_LIMITED', async () => {
    const limited = { status: 429, body: { code: 8 }, headers: { 'retry-after': '2' } };
    const { http, sleeps } = client([limited, limited, limited, limited]);
    const error = await http.request({ path: '/a' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ kind: 'RATE_LIMITED', details: { retryAfterMs: 2000 } });
    expect(sleeps).toEqual([2000, 2000, 2000]);
  });

  it('retries 5xx with growing backoff and succeeds', async () => {
    const { http, sleeps } = client([{ status: 502 }, { status: 503 }, { status: 200, body: 1 }]);
    await expect(http.request({ path: '/a' })).resolves.toMatchObject({ body: 1 });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('turns persistent 5xx into TRANSIENT', async () => {
    const { http } = client([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(http.request({ path: '/a' })).rejects.toMatchObject({ kind: 'TRANSIENT' });
  });

  it('does not retry other 4xx — the adapter maps them', async () => {
    const { http, calls } = client([{ status: 401, body: { code: 2 } }]);
    const error = await http.request({ path: '/a' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ status: 401, body: { code: 2 } });
    expect(calls).toHaveLength(1);
  });

  it('sends forms url-encoded', async () => {
    const { http, calls } = client([{ status: 200, body: {} }]);
    await http.request({
      path: '/t',
      method: 'POST',
      form: { grant_type: 'authorization_code', code: 'a b' },
    });
    expect(calls[0]!.init.body).toBe('grant_type=authorization_code&code=a+b');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });
});
