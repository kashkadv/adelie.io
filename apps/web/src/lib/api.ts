import { apiUrl } from './auth-client';

/** Fetch from apps/api with the session cookie. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, { ...init, credentials: 'include' });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}
