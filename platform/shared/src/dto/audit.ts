import { z } from 'zod';
import { AuditEntrySchema } from './assets.js';
import { PageQuerySchema, pageOf } from './common.js';

export const AuditQuerySchema = PageQuerySchema.extend({
  /** Substring match on the actor label (email) or actor id. */
  actor: z.string().optional(),
  /** Exact action or a prefix ending with a dot (e.g. `asset.`). */
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  /** ISO timestamps. */
  from: z.string().optional(),
  to: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditResponseSchema = pageOf(
  AuditEntrySchema.extend({
    actorId: z.string().nullable(),
    ip: z.string().nullable(),
    requestId: z.string().nullable(),
  }),
);
export type AuditResponse = z.infer<typeof AuditResponseSchema>;

/** Distinct actions and entity types present, for the filter selects. */
export const AuditFacetsSchema = z.object({
  actions: z.array(z.string()),
  entityTypes: z.array(z.string()),
  actors: z.array(z.string()),
});
export type AuditFacets = z.infer<typeof AuditFacetsSchema>;
