// Shared HTTP client for platform adapters (ADR-0011): per-bucket rate limiting from x-ratelimit-*
// headers, retries with growing backoff, timeouts, and recording of raw response bodies.
import { AdapterError } from './errors.js';

/** A raw API response for SyncPayload. Response body only — request headers (tokens) are never recorded. */
export interface RecordedResponse {
  endpoint: string;
  params: Record<string, string>;
  httpStatus: number;
  body: unknown;
  fetchedAt: Date;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Called for every response (including errors) — the orchestrator stores it in SyncPayload. */
  record?: (response: RecordedResponse) => void | Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Form body (OAuth token requests). */
  form?: Record<string, string>;
  /** Rate-limit bucket this endpoint counts against, e.g. 'read' or 'analytics'. */
  bucket?: string;
  /** Do not record the body (e.g. OAuth token responses contain secrets). */
  sensitive?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  status: number;
  body: T;
}

interface BucketState {
  remaining: number;
  resetAt: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parses the first integer of a header like "1000" or "1000, 1000;w=60". */
function headerInt(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export class HttpClient {
  private readonly buckets = new Map<string, BucketState>();
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async request<T>(opts: RequestOptions): Promise<HttpResponse<T>> {
    const params = Object.fromEntries(
      Object.entries(opts.query ?? {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    const url = new URL(opts.path, this.options.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const bucket = opts.bucket ?? 'default';

    for (let attempt = 0; ; attempt++) {
      await this.waitForBucket(bucket);

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: opts.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(opts.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            ...opts.headers,
          },
          body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
          signal: opts.signal
            ? AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)])
            : AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new AdapterError('TRANSIENT', `Network error: ${(error as Error).message}`);
      }

      this.updateBucket(bucket, response.headers);
      const body: unknown = await response.json().catch(() => null);
      if (!opts.sensitive) {
        await this.options.record?.({
          endpoint: opts.path,
          params,
          httpStatus: response.status,
          body,
          fetchedAt: new Date(this.now()),
        });
      }

      if (response.ok) return { status: response.status, body: body as T };

      const retryAfterMs = this.retryAfterMs(response.headers, bucket);
      if (response.status === 429) {
        if (attempt < this.maxRetries) {
          await this.sleep(retryAfterMs ?? this.backoff(attempt));
          continue;
        }
        throw new AdapterError('RATE_LIMITED', 'Rate limit exceeded', {
          status: 429,
          retryAfterMs: retryAfterMs ?? 60_000,
          providerCode: body,
        });
      }
      if (response.status >= 500) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new AdapterError('TRANSIENT', `Server error ${response.status}`, {
          status: response.status,
          providerCode: body,
        });
      }
      throw new HttpStatusError(response.status, body);
    }
  }

  /** Waits until the bucket has quota again if the last response said it is exhausted. */
  private async waitForBucket(bucket: string): Promise<void> {
    const state = this.buckets.get(bucket);
    if (!state || state.remaining > 0) return;
    const wait = state.resetAt - this.now();
    if (wait > 0) await this.sleep(wait);
    this.buckets.delete(bucket);
  }

  private updateBucket(bucket: string, headers: Headers): void {
    const remaining = headerInt(headers, 'x-ratelimit-remaining');
    const reset = headerInt(headers, 'x-ratelimit-reset');
    if (remaining === undefined) return;
    this.buckets.set(bucket, {
      remaining,
      resetAt: this.now() + (reset ?? 60) * 1000,
    });
  }

  private retryAfterMs(headers: Headers, bucket: string): number | undefined {
    const retryAfter = headerInt(headers, 'retry-after');
    if (retryAfter !== undefined) return retryAfter * 1000;
    const state = this.buckets.get(bucket);
    return state ? Math.max(0, state.resetAt - this.now()) : undefined;
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 1000 * 2 ** attempt);
  }
}

/** A 4xx response the adapter maps to a typed AdapterError (the mapping is platform-specific). */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}
