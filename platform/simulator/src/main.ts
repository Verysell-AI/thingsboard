import { pino } from 'pino';
import { loadConfig } from './config.js';
import { BookingsFeed } from './bookings.js';
import { syncClocksFromApi } from './clock-sync.js';
import { seedFromLiveState } from './live-seed.js';
import { buildControlApp } from './control.js';
import { Simulation } from './simulation.js';
import { TenantSync } from './tenant-sync.js';
import { loadTenantWorld } from './world.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({
    level: config.logLevel,
    ...(config.production
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  });

  const bookings = new BookingsFeed({
    apiUrl: config.apiUrl,
    internalToken: config.internalToken,
    log,
  });
  const sim = new Simulation({
    mqttUrl: config.mqttUrl,
    tickMs: config.tickMs,
    timeZone: config.timeZone,
    log,
    bookings,
  });
  const loadWorld = (tenant: string) => loadTenantWorld(config.datasetsDir, config.dataset, tenant);
  const apiOpts = { apiUrl: config.apiUrl, internalToken: config.internalToken, log };
  const tenantSync = new TenantSync(sim, {
    ...apiOpts,
    loadWorld,
    pollMs: config.tenantsPollMs,
    onAdded: async () => {
      // a tenant that appeared while running takes over the API's clock and counters like at boot
      await syncClocksFromApi(sim, apiOpts);
      await seedFromLiveState(sim, apiOpts);
    },
  });
  if (config.tenants.length > 0) {
    for (const tenant of config.tenants) {
      const world = loadWorld(tenant);
      sim.addTenant(world);
      log.info({ tenant, devices: world.devices.length }, 'loaded tenant dataset (SIM_TENANTS)');
    }
  } else {
    // the API decides which tenants are simulated; wait for it, then keep the list in sync
    await tenantSync.initial();
  }

  const app = buildControlApp(sim, {
    internalToken: config.internalToken,
    defaultTenant: config.tenants[0],
    loadWorld,
    logger: { level: config.logLevel },
  });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info(
    { port: config.port, mqtt: config.mqttUrl, tickMs: config.tickMs, timeZone: config.timeZone },
    'simulator control API listening',
  );

  const synced = await syncClocksFromApi(sim, apiOpts);
  log.info({ synced, clocks: sim.clocks() }, 'business clocks synced from the API');
  const seeded = await seedFromLiveState(sim, apiOpts);
  log.info({ seeded }, 'cumulative counters seeded from the platform live state');

  await bookings.refresh(sim.tenantKeys());
  await sim.start();
  if (config.tenants.length === 0) tenantSync.startPolling();
  // bookings are re-read on every tick so meeting rooms follow the business clock
  const poll = setInterval(() => void bookings.refresh(sim.tenantKeys()), config.tickMs);
  poll.unref?.();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(poll);
    tenantSync.stop();
    sim.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
