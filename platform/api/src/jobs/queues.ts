import { Queue, type ConnectionOptions } from 'bullmq';

/** Queue names shared by producers (API) and the worker. */
export const QUEUES = {
  /** automations.tick per tenant every minute, plus immediate runs. */
  automations: 'automations',
  /** morning and monthly reports */
  reports: 'reports',
  /** retried outbound calls (webhooks, mock ERP) */
  outbound: 'outbound',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface TenantJob {
  tenantId: string;
  tenantKey: string;
}

export interface AutomationJob extends TenantJob {
  kind: 'tick' | 'run';
  automationKey?: string;
  trigger?: string;
}

export function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
  };
}

export function createQueues(redisUrl: string) {
  const connection = connectionFromUrl(redisUrl);
  return {
    automations: new Queue<AutomationJob>(QUEUES.automations, { connection }),
    reports: new Queue<TenantJob>(QUEUES.reports, { connection }),
    outbound: new Queue(QUEUES.outbound, {
      connection,
      defaultJobOptions: { attempts: 8, backoff: { type: 'exponential', delay: 2_000 } },
    }),
  };
}
