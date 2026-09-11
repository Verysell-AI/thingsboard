import { z } from 'zod';

export const IdSchema = z.string().uuid();

/** RFC 7807 problem details emitted by the API error handler. */
export const ProblemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Validation issues, when status is 400. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    postgres: z.enum(['ok', 'fail']),
    redis: z.enum(['ok', 'fail']),
    thingsboard: z.enum(['ok', 'fail']),
  }),
  version: z.string(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(0),
    pageSize: z.number().int().min(1),
  });
}
