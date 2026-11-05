import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Single .env at the monorepo root (see .env.example). In CI vars come from the environment.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
