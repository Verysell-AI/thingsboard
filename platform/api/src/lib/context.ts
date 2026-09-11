import { asyncLocalStorage, requestContext } from '@fastify/request-context';
import type { Role } from '@platform/shared/roles';

/** Per-request (or per-job) context readable by services without parameter threading. */
export interface ContextStore {
  requestId: string;
  tenantId: string | null;
  tenantKey: string | null;
  userId: string | null;
  userEmail: string | null;
  role: Role | null;
  ip: string | null;
  /** Set by automation runs so audit rows link to the run. */
  automationRunId: string | null;
}

declare module '@fastify/request-context' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module augmentation must stay an interface
  interface RequestContextData extends ContextStore {}
}

export function emptyContext(requestId = 'system'): ContextStore {
  return {
    requestId,
    tenantId: null,
    tenantKey: null,
    userId: null,
    userEmail: null,
    role: null,
    ip: null,
    automationRunId: null,
  };
}

export function getContext(): ContextStore {
  const store = requestContext.getStore();
  return store ? (store as ContextStore) : emptyContext();
}

export function setContext(patch: Partial<ContextStore>): void {
  for (const [k, v] of Object.entries(patch)) {
    requestContext.set(k as keyof ContextStore, v as never);
  }
}

/**
 * Seeds the same AsyncLocalStorage the HTTP plugin uses, so BullMQ workers and the CLI can call
 * services that read the tenant and actor from context.
 */
export function runWithContext<T>(store: Partial<ContextStore>, fn: () => Promise<T>): Promise<T> {
  const data: ContextStore = { ...emptyContext(), ...store };
  // @fastify/request-context keeps the plain data object in its AsyncLocalStorage.
  return asyncLocalStorage.run(data as never, fn);
}

export function requireTenantId(): string {
  const { tenantId } = getContext();
  if (!tenantId) throw new Error('No tenant in context');
  return tenantId;
}
