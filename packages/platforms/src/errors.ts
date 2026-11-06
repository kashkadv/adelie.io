// Typed adapter errors (ADR-0011): the kind tells the sync orchestrator what to do.

export type AdapterErrorKind =
  /** Access token expired or rejected — refresh it and retry. */
  | 'TOKEN_EXPIRED'
  /** Refresh failed or access revoked — mark the connection "reauthorization required". */
  | 'REAUTH_REQUIRED'
  /** Rate limit hit after retries — wait `retryAfterMs` and continue. */
  | 'RATE_LIMITED'
  /** Network error or 5xx after retries — retry later. */
  | 'TRANSIENT'
  /** Missing scope / access tier / feature — skip the step, sync is PARTIAL. */
  | 'NOT_AVAILABLE'
  /** Bad request or unexpected response — a bug on our side, sync FAILED. */
  | 'INVALID';

export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    message: string,
    readonly details: { status?: number; retryAfterMs?: number; providerCode?: unknown } = {},
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export function isAdapterError(error: unknown, kind?: AdapterErrorKind): error is AdapterError {
  return error instanceof AdapterError && (kind === undefined || error.kind === kind);
}
