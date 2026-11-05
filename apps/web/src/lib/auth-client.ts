import { createAuthClient } from 'better-auth/react';

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Auth lives in apps/api (Better Auth mounted at /api/auth).
export const authClient = createAuthClient({ baseURL: apiUrl });
