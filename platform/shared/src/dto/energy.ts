import { z } from 'zod';
import { IdSchema } from './common.js';
import { SeriesPointSchema } from './assets.js';

export const ENERGY_RANGES = ['day', 'week', 'month'] as const;
export const EnergyRangeSchema = z.enum(ENERGY_RANGES);
export type EnergyRange = z.infer<typeof EnergyRangeSchema>;

/** Headline numbers for the Energy overview, computed from floor meters. */
export const EnergySummarySchema = z.object({
  /** Business time the summary was computed at. */
  ts: z.number().int(),
  currency: z.string(),
  tariffPerKwh: z.number(),
  powerNowW: z.number().nullable(),
  kwhToday: z.number().nullable(),
  kwhWeek: z.number().nullable(),
  kwhMonth: z.number().nullable(),
  costToday: z.number().nullable(),
  costMonth: z.number().nullable(),
  /** Mean power factor across floor meters right now. */
  powerFactor: z.number().nullable(),
  /** Energy consumed by empty rooms today (Phase 2); null until available. */
  wastedTodayKwh: z.number().nullable(),
});
export type EnergySummary = z.infer<typeof EnergySummarySchema>;

export const EnergyBreakdownItemSchema = z.object({
  scope: z.enum(['floor', 'room']),
  code: z.string(),
  name: z.string(),
  floor: z.number().int().nullable(),
  locationId: IdSchema.nullable(),
  powerNowW: z.number().nullable(),
  kwhToday: z.number().nullable(),
  costToday: z.number().nullable(),
  /** Share of the building's kWh today, 0..1. */
  share: z.number().nullable(),
});
export type EnergyBreakdownItem = z.infer<typeof EnergyBreakdownItemSchema>;

export const EnergyBreakdownSchema = z.object({
  scope: z.enum(['floor', 'room']),
  /** Floor filter applied when scope is room. */
  floor: z.number().int().nullable(),
  items: z.array(EnergyBreakdownItemSchema),
});
export type EnergyBreakdown = z.infer<typeof EnergyBreakdownSchema>;

export const TopConsumerSchema = z.object({
  assetId: IdSchema,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  room: z.string().nullable(),
  powerNowW: z.number(),
  kwhToday: z.number().nullable(),
});
export const TopConsumersSchema = z.object({ items: z.array(TopConsumerSchema) });
export type TopConsumers = z.infer<typeof TopConsumersSchema>;

export const EnergyTrendQuerySchema = z.object({
  scope: z.enum(['building', 'floor', 'room']).default('building'),
  /** Floor number or room code depending on scope. */
  code: z.string().optional(),
  range: EnergyRangeSchema.default('day'),
});
export type EnergyTrendQuery = z.infer<typeof EnergyTrendQuerySchema>;

export const EnergyTrendSchema = z.object({
  scope: z.enum(['building', 'floor', 'room']),
  code: z.string().nullable(),
  range: EnergyRangeSchema,
  from: z.number().int(),
  to: z.number().int(),
  interval: z.number().int(),
  /** Average power per bucket, watts. */
  power: z.array(SeriesPointSchema),
  /** Energy per bucket, kWh (difference of the cumulative meter). */
  energy: z.array(SeriesPointSchema),
  /** Power factor per bucket when the scope has a meter reporting it. */
  powerFactor: z.array(SeriesPointSchema),
});
export type EnergyTrend = z.infer<typeof EnergyTrendSchema>;

/** Bucket used for each range, in ms. */
export const ENERGY_RANGE_INTERVAL_MS: Record<EnergyRange, number> = {
  day: 15 * 60_000,
  week: 60 * 60_000,
  month: 6 * 60 * 60_000,
};

export const ENERGY_RANGE_MS: Record<EnergyRange, number> = {
  day: 24 * 3_600_000,
  week: 7 * 24 * 3_600_000,
  month: 30 * 24 * 3_600_000,
};
