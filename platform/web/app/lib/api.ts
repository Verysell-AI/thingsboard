import type { z } from 'zod';
import type { ProblemDetails, TokenPair } from '@platform/shared/dto';
import { adminSession, tenantSession, type Session } from './auth';

/** All browser calls go through this base; nginx and the Vite dev server strip it. */
export const API_BASE = '/api';

const TENANT_KEY_STORAGE = 'platform.tenantKey';

/**
 * A phone on the demo Wi-Fi cannot resolve `alpha.localhost`, so the app may be opened on the bare
 * host with `?tenant=alpha`. The key is remembered for the tab and sent as `X-Tenant-Key`, which the
 * API honours only for tenants in demo mode.
 */
export function tenantKeyOverride(
  search = typeof location === 'undefined' ? '' : location.search,
): string | null {
  const fromQuery = new URLSearchParams(search).get('tenant');
  try {
    if (fromQuery) {
      sessionStorage.setItem(TENANT_KEY_STORAGE, fromQuery);
      return fromQuery;
    }
    return sessionStorage.getItem(TENANT_KEY_STORAGE);
  } catch {
    return fromQuery;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly body: unknown;

  constructor(status: number, title: string, detail?: string, body?: unknown) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.body = body;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Return the body even for 4xx/5xx responses whose status is listed here (e.g. 501 scenario results). */
  acceptStatuses?: number[];
  signal?: AbortSignal;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toApiError(res: Response, body: unknown): ApiError {
  const problem = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Partial<ProblemDetails>;
  return new ApiError(
    res.status,
    problem.title ?? res.statusText ?? 'Request failed',
    problem.detail,
    body,
  );
}

export interface ApiClient {
  /** Fetches a binary or text file with the session's token and offers it as a download. */
  download(path: string, filename: string): Promise<void>;
  get<T>(
    path: string,
    schema?: z.ZodType<T>,
    opts?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
    opts?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T>(path: string, body?: unknown, schema?: z.ZodType<T>): Promise<T>;
  delete<T>(path: string, schema?: z.ZodType<T>): Promise<T>;
}

function validate<T>(schema: z.ZodType<T> | undefined, value: unknown): T {
  if (!schema) return value as T;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(0, 'Unexpected response shape', parsed.error.message, value);
  }
  return parsed.data;
}

/** One client per session: the tenant app and the platform console refresh on different routes. */
export function createApiClient(session: Session, refreshPath: string): ApiClient {
  let refreshing: Promise<boolean> | null = null;

  /** Exchanges the refresh token once; concurrent callers share the same attempt. */
  async function tryRefresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    const current = session.getTokens();
    if (!current?.refreshToken) return false;
    refreshing = (async () => {
      try {
        const tenantKey = tenantKeyOverride();
        const res = await fetch(apiUrl(refreshPath), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(tenantKey ? { 'x-tenant-key': tenantKey } : {}),
          },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) {
          session.clearTokens();
          return false;
        }
        session.setTokens((await res.json()) as TokenPair);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const tenantKey = tenantKeyOverride();
    if (tenantKey) headers['x-tenant-key'] = tenantKey;
    const token = session.getAccessToken();
    if (opts.auth !== false && token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(apiUrl(path), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });

    if (res.status === 401 && opts.auth !== false && !retried && token) {
      if (await tryRefresh()) return request<T>(path, opts, true);
      session.clearTokens();
    }

    const body = await parseBody(res);
    if (!res.ok && !opts.acceptStatuses?.includes(res.status)) throw toApiError(res, body);
    return body as T;
  }

  return {
    async download(path, filename) {
      const token = session.getAccessToken();
      const tenantKey = tenantKeyOverride();
      const res = await fetch(apiUrl(path), {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(tenantKey ? { 'x-tenant-key': tenantKey } : {}),
        },
      });
      if (!res.ok) throw toApiError(res, await parseBody(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    get(path, schema, opts) {
      return request<unknown>(path, { ...opts, method: 'GET' }).then((v) => validate(schema, v));
    },
    post(path, body, schema, opts) {
      return request<unknown>(path, { ...opts, method: 'POST', body }).then((v) =>
        validate(schema, v),
      );
    },
    patch(path, body, schema) {
      return request<unknown>(path, { method: 'PATCH', body }).then((v) => validate(schema, v));
    },
    delete(path, schema) {
      return request<unknown>(path, { method: 'DELETE' }).then((v) => validate(schema, v));
    },
  };
}

export const api = createApiClient(tenantSession, '/auth/refresh');
export const adminApi = createApiClient(adminSession, '/admin/auth/refresh');

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
