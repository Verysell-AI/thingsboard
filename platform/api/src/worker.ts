import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { runWithContext } from './lib/context.js';
import {
  processAutomationJob,
  registerAutomationSchedules,
  type AutomationQueue,
} from './jobs/automations.processor.js';
import { QUEUES, connectionFromUrl, type AutomationJob, type TenantJob } from './jobs/queues.js';

/**
 * BullMQ workers run here, never in the HTTP process. Each job seeds the same request context the
 * API uses so services and the audit writer see the tenant. The automations queue runs the engine
 * (a repeatable tick per tenant plus immediate runs); reports and outbound still acknowledge only.
 */
const SCHEDULE_REFRESH_MS = 5 * 60_000;
async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: config.LOG_LEVEL });
  const container = buildContainer(config);
  const connection = connectionFromUrl(config.REDIS_URL);

  const processor = (queue: string) => async (job: Job<TenantJob>) => {
    const { tenantId, tenantKey } = job.data ?? {};
    await runWithContext(
      {
        requestId: `job:${queue}:${job.id}`,
        tenantId: tenantId ?? null,
        tenantKey: tenantKey ?? null,
      },
      async () => {
        log.info(
          { queue, jobId: job.id, name: job.name, tenantKey },
          'no processor registered yet; job acknowledged',
        );
      },
    );
  };

  const automationQueue = container.automationQueue();
  const automationWorker = new Worker<AutomationJob>(
    QUEUES.automations,
    (job) => processAutomationJob(container, automationQueue, job, log),
    { connection, concurrency: 2 },
  );
  const workers = [
    automationWorker,
    ...Object.values(QUEUES)
      .filter((name) => name !== QUEUES.automations)
      .map((name) => new Worker(name, processor(name), { connection, concurrency: 4 })),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));
  }

  const refresh = async () => {
    if (!automationQueue) return;
    await registerAutomationSchedules(automationQueue as AutomationQueue, container, log).catch(
      (err) => log.error({ err }, 'could not schedule automation ticks'),
    );
  };
  await refresh();
  const refreshTimer = setInterval(() => void refresh(), SCHEDULE_REFRESH_MS);
  log.info({ queues: Object.values(QUEUES) }, 'worker started');

  const shutdown = async () => {
    log.info('worker shutting down');
    clearInterval(refreshTimer);
    await Promise.all(workers.map((w) => w.close()));
    await container.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
