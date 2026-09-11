import { resolve } from 'node:path';
import Fastify from 'fastify';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import app from './app.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { createDb } from './db/index.js';

/** Production entrypoint: migrate as the admin role, then serve. */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL, config.DATABASE_ADMIN_URL);
  const migrationsFolder = resolve(import.meta.dirname, '..', 'drizzle');
  await migrate(db.admin, { migrationsFolder });

  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: true,
  });
  // built here, not inside the app plugin, so the bootstrap below can reach the services
  const container = buildContainer(config, { db });
  await fastify.register(app, { config, container });

  if (config.PLATFORM_ADMIN_PASSWORD) {
    const result = await container.platformAdmins.seed(
      config.PLATFORM_ADMIN_EMAIL,
      config.PLATFORM_ADMIN_PASSWORD,
      'Platform Admin',
    );
    fastify.log.info({ admin: config.PLATFORM_ADMIN_EMAIL, result }, 'platform admin seeded');
  } else {
    fastify.log.warn('PLATFORM_ADMIN_PASSWORD is unset; the /admin console has no login');
  }

  const shutdown = async () => {
    fastify.log.info('shutting down');
    await fastify.close();
    await container.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await fastify.listen({ port: config.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
