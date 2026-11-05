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
  auth: {
    secret: required('BETTER_AUTH_SECRET'),
    url: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:4000',
  },
} as const;
