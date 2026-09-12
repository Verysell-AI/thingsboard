import { Command } from 'commander';
import { ROLES, RoleSchema } from '@platform/shared/roles';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { withTenant } from './db/tenant.js';
import { runBackfill } from './cli/backfill/index.js';
import { loadDatasetIntoTenant } from './cli/dataset.js';
import { provision } from './cli/provision.js';

const program = new Command();
program.name('platform').description('Provisioning and dataset tooling for the platform API');

/**
 * The CLI owns its Redis client (lazy, so commands that never touch Redis do not need it) and must
 * disconnect it itself, otherwise a command that read the business clock keeps the process alive.
 */
function makeContainer() {
  const config = loadConfig();
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const container = buildContainer(config, { redis });
  const close = container.close.bind(container);
  container.close = async () => {
    await close();
    redis.disconnect();
  };
  return container;
}

const log = (msg: string) => console.log(`  • ${msg}`);

program
  .command('provision')
  .description('Create or update a tenant in ThingsBoard and the platform database')
  .requiredOption('--tenant <key>', 'tenant key, e.g. alpha')
  .option('--dataset <name>', 'dataset whose tenants/<key>.json provides name, hostname and brand')
  .option('--demo', 'enable demo mode when no dataset is given', false)
  .action(async (opts: { tenant: string; dataset?: string; demo: boolean }) => {
    const container = makeContainer();
    try {
      console.log(
        `Provisioning tenant ${opts.tenant}${opts.dataset ? ` from dataset ${opts.dataset}` : ''}`,
      );
      const r = await provision(container, { ...opts, log });
      console.table({
        tenant: r.tenant.key,
        hostname: r.tenant.hostname,
        demoMode: r.tenant.demoMode,
        simulated: r.tenant.simulated,
        tbTenantId: r.tbTenantId,
        serviceUsers: r.users.join(', '),
        deviceProfiles: r.deviceProfiles,
        assetProfiles: r.assetProfiles,
        ruleChain: r.ruleChain ?? '(none)',
        dashboards: r.dashboards,
        seconds: (r.elapsedMs / 1000).toFixed(1),
      });
    } finally {
      await container.close();
    }
  });

program
  .command('dataset')
  .description('Load a dataset (locations, devices, employees, users, automations) into a tenant')
  .requiredOption('--tenant <key>', 'tenant key')
  .requiredOption('--dataset <name>', 'dataset folder under datasets/')
  .option('--reset', 'delete the dataset entities first', false)
  .action(async (opts: { tenant: string; dataset: string; reset: boolean }) => {
    const container = makeContainer();
    try {
      console.log(
        `Loading dataset ${opts.dataset} into tenant ${opts.tenant}${opts.reset ? ' (reset)' : ''}`,
      );
      const r = await loadDatasetIntoTenant(container, { ...opts, log });
      console.table({ ...r, seconds: (r.elapsedMs / 1000).toFixed(1) });
    } finally {
      await container.close();
    }
  });

program
  .command('user')
  .description(
    'Create or update a platform user in a tenant (for tenants provisioned without a dataset)',
  )
  .requiredOption('--tenant <key>', 'tenant key, e.g. gamma')
  .requiredOption('--email <email>', 'login email')
  .option('--role <role>', `one of ${ROLES.join(', ')}`, 'TENANT_ADMIN')
  .option(
    '--password <password>',
    'password; defaults to DATASET_USER_PASSWORD from the environment',
  )
  .option('--name <displayName>', 'display name; defaults to the email local part')
  .action(
    async (opts: {
      tenant: string;
      email: string;
      role: string;
      password?: string;
      name?: string;
    }) => {
      const container = makeContainer();
      try {
        const role = RoleSchema.parse(opts.role);
        const tenant = await container.tenants.byKey(opts.tenant);
        if (!tenant) {
          console.error(`tenant ${opts.tenant} not found; run provision first`);
          process.exit(1);
        }
        const password = opts.password ?? container.config.DATASET_USER_PASSWORD;
        const user = await withTenant(container.db.app, tenant.id, (tx) =>
          container.users.upsertInTx(tx, tenant.id, {
            email: opts.email,
            password,
            role,
            displayName: opts.name ?? opts.email.split('@')[0] ?? opts.email,
          }),
        );
        console.table({
          tenant: tenant.key,
          hostname: tenant.hostname,
          email: user.email,
          role: user.role,
          password: opts.password ? '(as given)' : '(DATASET_USER_PASSWORD)',
        });
      } finally {
        await container.close();
      }
    },
  );

program
  .command('admin')
  .description('Create or update a platform admin for the /admin console')
  .requiredOption('--email <email>', 'login email')
  .option('--password <password>', 'password; defaults to PLATFORM_ADMIN_PASSWORD')
  .option('--name <displayName>', 'display name', 'Platform Admin')
  .action(async (opts: { email: string; password?: string; name: string }) => {
    const container = makeContainer();
    try {
      const password = opts.password ?? container.config.PLATFORM_ADMIN_PASSWORD;
      if (!password) {
        console.error('no password given and PLATFORM_ADMIN_PASSWORD is empty');
        process.exit(1);
      }
      const result = await container.platformAdmins.seed(opts.email, password, opts.name);
      console.table({ email: opts.email, result });
    } finally {
      await container.close();
    }
  });

program
  .command('backfill')
  .description(
    'Write weeks of plausible history for a tenant (telemetry, statistics, sweep runs, bookings)',
  )
  .requiredOption('--tenant <key>', 'tenant key')
  .option('--weeks <n>', 'weeks of history, ending yesterday', '12')
  .option('--dataset <name>', 'dataset whose personas.json drives the schedules', 'office-demo')
  .option('--purge', 'delete the range from the IoT core first', false)
  .action(async (opts: { tenant: string; weeks: string; dataset: string; purge: boolean }) => {
    const container = makeContainer();
    try {
      const weeks = Math.max(1, Math.min(26, Number(opts.weeks) || 12));
      console.log(
        `Backfilling ${weeks} weeks for tenant ${opts.tenant}${opts.purge ? ' (purge)' : ''}`,
      );
      const r = await runBackfill(container, { ...opts, weeks, log });
      console.table({ ...r, seconds: (r.elapsedMs / 1000).toFixed(1) });
      console.log('Restart the simulator so its counters continue from the backfilled values.');
    } finally {
      await container.close();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
