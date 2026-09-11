import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      'postgres://app_admin:app-admin-dev-password@localhost:5434/platform',
  },
  entities: {
    roles: { provider: '', include: ['app', 'app_admin'] },
  },
});
