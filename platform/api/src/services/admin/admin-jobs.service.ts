import { randomUUID } from 'node:crypto';
import type { AdminJob } from '@platform/shared/dto';
import type { RedisLike } from '../../lib/redis.js';

const KEY = (id: string) => `admin:job:${id}`;
/** Long enough for an operator to come back to a finished provisioning run. */
const TTL_SECONDS = 3600;
const MAX_LOG_LINES = 500;

export type AdminJobKind = AdminJob['kind'];

/**
 * Provisioning takes tens of seconds of ThingsBoard calls, longer than a comfortable request. The
 * task runs in the API process and reports through a Redis record the console polls.
 */
export class AdminJobsService {
  constructor(
    private readonly redis: RedisLike,
    private readonly onError: (err: unknown, job: AdminJob) => void = () => undefined,
  ) {}

  /** Starts `run` in the background and returns the record to poll. */
  async start(
    kind: AdminJobKind,
    tenantKey: string,
    run: (log: (line: string) => void) => Promise<void>,
  ): Promise<AdminJob> {
    const job: AdminJob = {
      id: randomUUID(),
      kind,
      tenantKey,
      status: 'running',
      log: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    await this.save(job);
    void this.execute(job, run);
    return job;
  }

  async get(id: string): Promise<AdminJob | null> {
    const raw = await this.redis.get(KEY(id));
    return raw ? (JSON.parse(raw) as AdminJob) : null;
  }

  private async execute(
    job: AdminJob,
    run: (log: (line: string) => void) => Promise<void>,
  ): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve();
    const log = (line: string) => {
      if (job.log.length < MAX_LOG_LINES) job.log.push(line);
      // writes are serialised so the record never goes backwards under fast logging
      pending = pending.then(() => this.save(job)).catch(() => undefined);
    };
    try {
      await run(log);
      job.status = 'succeeded';
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      this.onError(err, job);
    }
    job.finishedAt = new Date().toISOString();
    await pending;
    await this.save(job).catch(() => undefined);
  }

  private async save(job: AdminJob): Promise<void> {
    await this.redis.set(KEY(job.id), JSON.stringify(job), 'EX', TTL_SECONDS);
  }
}
