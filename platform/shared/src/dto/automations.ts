import { z } from 'zod';
import { IdSchema, PageQuerySchema, pageOf } from './common.js';

/** Automation keys (context §9). Real tenants start with all of them disabled. */
export const AUTOMATION_KEYS = [
  'room_auto_off',
  'ghost_booking',
  'precool',
  'evening_sweep',
  'peak_shedding',
  'holiday_mode',
] as const;
export const AutomationKeySchema = z.enum(AUTOMATION_KEYS);
export type AutomationKey = z.infer<typeof AutomationKeySchema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RoomAutoOffParamsSchema = z.object({
  /** Minutes a meeting room must be empty (no people, no laptops, no booking) before it is switched off. */
  idleMinutes: z.number().int().min(1).max(240).default(15),
});
export const GhostBookingParamsSchema = z.object({
  /** Minutes after the start of a booking with nobody in the room before it is released. */
  graceMinutes: z.number().int().min(1).max(120).default(10),
});
export const PrecoolParamsSchema = z.object({
  /** Minutes before the first booking of the day the AC starts. */
  leadMinutes: z.number().int().min(5).max(120).default(30),
  setpointC: z.number().min(16).max(30).default(22),
});
export const EveningSweepParamsSchema = z.object({
  /** Wall-clock time in the platform zone. */
  time: z.string().regex(HHMM, 'expected HH:MM').default('20:00'),
  /** A booking starting within this many minutes keeps its room on. */
  graceMinutes: z.number().int().min(0).max(240).default(15),
});
export const SHED_STEPS = ['unoccupied_rooms', 'pantry', 'open_plan_ac_setpoint+2'] as const;
export const ShedStepSchema = z.enum(SHED_STEPS);
export type ShedStep = z.infer<typeof ShedStepSchema>;
export const PeakSheddingParamsSchema = z.object({
  thresholdKw: z.number().positive().default(150),
  /** "HH:MM-HH:MM" window in the platform zone. */
  window: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM-HH:MM')
    .default('12:00-14:00'),
  order: z
    .array(ShedStepSchema)
    .min(1)
    .default([...SHED_STEPS]),
  /** Restore when the load has stayed below threshold − restoreBelowPct % for restoreAfterMinutes. */
  restoreBelowPct: z.number().min(0).max(50).default(10),
  restoreAfterMinutes: z.number().int().min(1).max(120).default(10),
});
export const HolidayModeParamsSchema = z.object({
  /** ISO dates (YYYY-MM-DD) treated as holidays. */
  dates: z.array(z.string().regex(ISO_DATE)).default([]),
  sweepTime: z.string().regex(HHMM).default('00:01'),
});

export const AUTOMATION_PARAMS = {
  room_auto_off: RoomAutoOffParamsSchema,
  ghost_booking: GhostBookingParamsSchema,
  precool: PrecoolParamsSchema,
  evening_sweep: EveningSweepParamsSchema,
  peak_shedding: PeakSheddingParamsSchema,
  holiday_mode: HolidayModeParamsSchema,
} as const satisfies Record<AutomationKey, z.ZodType>;

export type AutomationParams = {
  [K in AutomationKey]: z.infer<(typeof AUTOMATION_PARAMS)[K]>;
};

/** Parses stored params for a key, filling defaults and dropping unknown fields. */
export function parseAutomationParams<K extends AutomationKey>(
  key: K,
  raw: unknown,
): AutomationParams[K] {
  return AUTOMATION_PARAMS[key].parse(raw ?? {}) as AutomationParams[K];
}

export const AutomationRunSchema = z.object({
  id: IdSchema,
  key: z.string(),
  /** Real timestamps of the run; the business time it evaluated is in `summary.businessTime`. */
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  trigger: z.string(),
  summary: z.record(z.string(), z.unknown()),
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const AutomationSchema = z.object({
  id: IdSchema,
  key: AutomationKeySchema,
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()),
  lastRun: AutomationRunSchema.nullable(),
  updatedAt: z.string(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationsResponseSchema = z.object({ items: z.array(AutomationSchema) });
export type AutomationsResponse = z.infer<typeof AutomationsResponseSchema>;

export const UpdateAutomationSchema = z.object({
  enabled: z.boolean().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateAutomation = z.infer<typeof UpdateAutomationSchema>;

export const AutomationRunsQuerySchema = PageQuerySchema.extend({
  key: AutomationKeySchema.optional(),
});
export const AutomationRunsResponseSchema = pageOf(AutomationRunSchema);
export type AutomationRunsResponse = z.infer<typeof AutomationRunsResponseSchema>;

/**
 * Body of POST /automations/:key/run (manual trigger); `scope` narrows the sweep to one zone or
 * floor, `action` drives peak shedding by hand ("Shed now" / "Restore").
 */
export const RunAutomationSchema = z.object({
  scope: z.object({ zone: z.string().optional(), floor: z.number().int().optional() }).optional(),
  action: z.enum(['shed', 'restore']).optional(),
});
export type RunAutomation = z.infer<typeof RunAutomationSchema>;

/**
 * What a rule decided for one target. Rules are pure: they return decisions, the engine applies
 * them (commands through CommandsService, bookings through BookingsService, notifications).
 */
export const DecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'),
    room: z.string(),
    deviceCode: z.string(),
    assetId: IdSchema,
    method: z.enum(['setState', 'setSetpoint']),
    params: z.record(z.string(), z.unknown()),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('release_booking'),
    bookingId: IdSchema,
    room: z.string(),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('notify'),
    userIds: z.array(IdSchema).optional(),
    roles: z.array(z.string()).optional(),
    notificationKind: z.string(),
    title: z.string(),
    body: z.string().optional(),
    subject: z.string().optional(),
    actions: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  }),
  z.object({
    kind: z.literal('skip'),
    room: z.string(),
    reason: z.string(),
    /** Free text such as the laptop owner's name or the booking title. */
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal('note'), message: z.string() }),
  /** Extra fields a rule wants on the run summary (savings estimate, kept zones, shedding state). */
  z.object({ kind: z.literal('summary'), data: z.record(z.string(), z.unknown()) }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Skip reasons the evening sweep and auto-off report (context phase 3 §1). */
export const SKIP_REASONS = [
  'laptop_online',
  'occupied',
  'booking_within_grace',
  'zone_kept_for',
  'manual_hold',
  'critical_room',
  'already_off',
  'not_idle_long_enough',
  'holiday',
  'already_on',
  'not_due',
  'no_booking',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** One command peak shedding will undo when the load recovers (the reverse of what it sent). */
export const ShedUndoSchema = z.object({
  assetId: IdSchema,
  deviceCode: z.string(),
  room: z.string(),
  method: z.enum(['setState', 'setSetpoint']),
  params: z.record(z.string(), z.unknown()),
});
export type ShedUndo = z.infer<typeof ShedUndoSchema>;

export const PEAK_STATUSES = ['NORMAL', 'SHEDDING', 'RECOVERING'] as const;
export const PeakStatusSchema = z.enum(PEAK_STATUSES);
export type PeakStatus = z.infer<typeof PeakStatusSchema>;

/** Persisted state machine of peak shedding: which steps are applied and what restores them. */
export const PeakSheddingStateSchema = z.object({
  status: PeakStatusSchema.default('NORMAL'),
  /** Number of `order` steps currently applied. */
  level: z.number().int().min(0).default(0),
  /** Business time the first step was applied; null when NORMAL. */
  sinceMs: z.number().int().nullable().default(null),
  /** Business time the load first stayed under the restore threshold; null when not recovering. */
  belowSinceMs: z.number().int().nullable().default(null),
  /** Steps applied, in order, with the commands that undo them. */
  steps: z.array(z.object({ step: ShedStepSchema, undo: z.array(ShedUndoSchema) })).default([]),
  /** Building load (kW) at the last evaluation. */
  lastKw: z.number().nullable().default(null),
});
export type PeakSheddingState = z.infer<typeof PeakSheddingStateSchema>;

export const PeakStateResponseSchema = z.object({
  state: PeakSheddingStateSchema,
  thresholdKw: z.number(),
  window: z.string(),
  buildingKw: z.number().nullable(),
  inWindow: z.boolean(),
  enabled: z.boolean(),
});
export type PeakStateResponse = z.infer<typeof PeakStateResponseSchema>;
