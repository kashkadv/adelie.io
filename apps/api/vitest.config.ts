import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Unit tests never touch a real database; dummy values satisfy config validation.
    env: {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    },
  },
});
