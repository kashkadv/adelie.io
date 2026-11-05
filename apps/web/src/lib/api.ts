import { apiUrl } from './auth-client';

/** Non-2xx response from apps/api; `body` is the parsed JSON error, if any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    path: string,
  ) {
    super(`API ${status}: ${path}`);
  }
}

/** Fetch from apps/api with the session cookie. JSON bodies: pass `json` instead of `body`. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(`${apiUrl}${path}`, {
    ...rest,
    credentials: 'include',
    headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null), path);
  return res.json() as Promise<T>;
}
