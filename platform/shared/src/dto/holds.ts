import { z } from 'zod';
import { IdSchema } from './common.js';

export const HOLD_SCOPES = ['ZONE', 'FLOOR', 'ROOM'] as const;
export const HoldScopeSchema = z.enum(HOLD_SCOPES);
export type HoldScope = z.infer<typeof HoldScopeSchema>;

/** A hold keeps a scope powered until `until` whatever the automations decide (late worker, event tonight). */
export const HoldSchema = z.object({
  id: IdSchema,
  scopeType: HoldScopeSchema,
  /** Zone code, floor number as text, or room code. */
  scopeId: z.string(),
  until: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
export type Hold = z.infer<typeof HoldSchema>;

export const CreateHoldSchema = z.object({
  scopeType: HoldScopeSchema,
  scopeId: z.string().min(1),
  /** ISO timestamp; must be in the future (business clock). */
  until: z.string().datetime({ offset: true }),
  reason: z.string().min(1).max(200),
});
export type CreateHold = z.infer<typeof CreateHoldSchema>;

export const HoldsResponseSchema = z.object({ items: z.array(HoldSchema) });
export type HoldsResponse = z.infer<typeof HoldsResponseSchema>;
