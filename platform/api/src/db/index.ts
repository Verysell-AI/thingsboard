import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

export interface DbHandles {
  /** RLS-restricted `app` role; every query must run inside withTenant(). */
  app: Db;
  /** `app_admin` role with BYPASSRLS; provisioning, jobs and migrations only. */
  admin: Db;
  appPool: pg.Pool;
  adminPool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(appUrl: string, adminUrl: string): DbHandles {
  const appPool = new pg.Pool({ connectionString: appUrl, max: 10 });
  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 4 });
  return {
    app: drizzle(appPool, { schema }),
    admin: drizzle(adminPool, { schema }),
    appPool,
    adminPool,
    async close() {
      await Promise.all([appPool.end(), adminPool.end()]);
    },
  };
}
