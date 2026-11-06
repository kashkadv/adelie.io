import { existsSync } from 'node:fs';

// Single .env at the monorepo root; in production vars come from the environment.
const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env['API_PORT'] ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  webUrl: process.env['WEB_URL'] ?? 'http://localhost:3000',
  /** Public URL of this API — OAuth redirect URIs are built from it. */
  apiUrl: process.env['API_URL'] ?? 'http://localhost:4000',
  /** Optional: connecting Pinterest is unavailable without it. */
  pinterest:
    process.env['PINTEREST_APP_ID'] && process.env['PINTEREST_APP_SECRET']
      ? { appId: process.env['PINTEREST_APP_ID'], appSecret: process.env['PINTEREST_APP_SECRET'] }
      : undefined,
  auth: {
    secret: required('BETTER_AUTH_SECRET'),
    url: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:4000',
  },
} as const;
