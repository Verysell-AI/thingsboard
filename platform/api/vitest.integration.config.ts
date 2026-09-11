import { defineConfig } from 'vitest/config';

/**
 * Integration tests need Postgres and Redis: set TEST_DATABASE_URL (superuser) and TEST_REDIS_URL.
 * @fastify/autoload imports plugins with Node's own loader, so source modules are loaded natively
 * through tsx (not through Vite) to keep a single module instance per file.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    execArgv: ['--import', 'tsx'],
    server: { deps: { external: [/\/api\/src\//] } },
  },
});
