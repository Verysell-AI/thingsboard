import { z } from 'zod';
import { IdSchema } from './common.js';

/* ---------------------------------------------------------------------------------------------
 * Insights (ladder level 4): cost allocation, standby hunt, AC health, fleet health, utilisation,
 * savings versus baseline, depreciation and the lifecycle calendar.
 * ------------------------------------------------------------------------------------------- */

const ISO_MONTH = /^\d{4}-\d{2}$/;

/** Monthly energy cost per department; meeting rooms follow the booking organiser, the rest is Shared. */
export const EnergyCostRowSchema = z.object({
  /** YYYY-MM */
  month: z.string().regex(ISO_MONTH),
  department: z.string(),
  kwh: z.number(),
  cost: z.number(),
});
export const EnergyCostReportSchema = z.object({
  currency: z.string(),
  tariffPerKwh: z.number(),
  /** Oldest first. */
  months: z.array(z.string().regex(ISO_MONTH)),
  departments: z.array(z.string()),
  rows: z.array(EnergyCostRowSchema),
  totals: z.array(z.object({ month: z.string(), kwh: z.number(), cost: z.number() })),
});
export type EnergyCostRow = z.infer<typeof EnergyCostRowSchema>;
export type EnergyCostReport = z.infer<typeof EnergyCostReportSchema>;

export const EnergyCostQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(3),
});

/** A device that sits between 5 and 80 W through the night on most nights. */
export const StandbyItemSchema = z.object({
  assetId: IdSchema,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  room: z.string().nullable(),
  avgNightPowerW: z.number(),
  nightsFlagged: z.number().int(),
  nightsObserved: z.number().int(),
  kwhPerYear: z.number(),
  costPerYear: z.number(),
  recommendation: z.string(),
  acknowledged: z.boolean(),
  acknowledgedBy: z.string().nullable(),
});
export const StandbyReportSchema = z.object({
  currency: z.string(),
  windowNights: z.number().int(),
  items: z.array(StandbyItemSchema),
  totalKwhPerYear: z.number(),
  totalCostPerYear: z.number(),
});
export type StandbyItem = z.infer<typeof StandbyItemSchema>;
export type StandbyReport = z.infer<typeof StandbyReportSchema>;

export const StandbyAckSchema = z.object({
  acknowledged: z.boolean(),
  note: z.string().max(500).optional(),
});

export const AcHealthItemSchema = z.object({
  assetId: IdSchema,
  code: z.string(),
  name: z.string(),
  room: z.string().nullable(),
  runtimeH: z.number().nullable(),
  nominalCurrentA: z.number().nullable(),
  currentNowA: z.number().nullable(),
  /** Mean current over the last 24 h versus 14 days ago at constant setpoint, as a fraction (0.27 = +27 %). */
  currentDrift: z.number().nullable(),
  filterAlarm: z.boolean(),
  openTaskId: IdSchema.nullable(),
  warrantyEnd: z.string().nullable(),
  status: z.enum(['healthy', 'watch', 'alarm']),
});
export const AcHealthReportSchema = z.object({ items: z.array(AcHealthItemSchema) });
export type AcHealthItem = z.infer<typeof AcHealthItemSchema>;
export type AcHealthReport = z.infer<typeof AcHealthReportSchema>;

export const FleetItemSchema = z.object({
  assetId: IdSchema,
  code: z.string(),
  name: z.string(),
  custodian: z.string().nullable(),
  department: z.string().nullable(),
  /** Mean battery level while docked over the last 30 days, a proxy for capacity. */
  batteryHealthPct: z.number().nullable(),
  lastOnlineAt: z.string().nullable(),
  daysOffline: z.number().int().nullable(),
  warrantyEnd: z.string().nullable(),
  flags: z.array(z.enum(['replace_soon', 'reclaim', 'warranty_expiring', 'misplaced'])),
});
export const FleetReportSchema = z.object({
  total: z.number().int(),
  online: z.number().int(),
  replaceSoon: z.number().int(),
  reclaim: z.number().int(),
  warrantyExpiring: z.number().int(),
  items: z.array(FleetItemSchema),
});
export type FleetItem = z.infer<typeof FleetItemSchema>;
export type FleetReport = z.infer<typeof FleetReportSchema>;

/** hour × weekday utilisation per room over the window, from RoomDailyStat and bookings. */
export const UtilisationRoomSchema = z.object({
  roomId: IdSchema,
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  /** 0..1 share of working hours the room was occupied. */
  utilisation: z.number(),
  /** 0..1 share of working hours the room was booked. */
  booked: z.number(),
  ghostRate: z.number(),
  /** [weekday 0..6][hour 0..23] occupied share 0..1. */
  heatmap: z.array(z.array(z.number())),
  recommendation: z.string().nullable(),
});
export const UtilisationReportSchema = z.object({
  weeks: z.number().int(),
  from: z.string(),
  to: z.string(),
  rooms: z.array(UtilisationRoomSchema),
});
export type UtilisationRoom = z.infer<typeof UtilisationRoomSchema>;
export type UtilisationReport = z.infer<typeof UtilisationReportSchema>;

export const UtilisationQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(12),
});

export const SavingsFloorSchema = z.object({
  floor: z.number().int(),
  baselineNightKwh: z.number(),
  recentNightKwh: z.number(),
  savedKwhPerNight: z.number(),
  savedPct: z.number(),
});
export const SavingsReportSchema = z.object({
  currency: z.string(),
  /** Weeks of baseline before automation and weeks of measured operation after it. */
  baselineWeeks: z.number().int(),
  recentWeeks: z.number().int(),
  /** ISO date the automation went live (measured window starts here). */
  automationSince: z.string(),
  floors: z.array(SavingsFloorSchema),
  totalSavedKwh: z.number(),
  totalSavedCost: z.number(),
  /** Per weekday night in the window, oldest first: {date, kwh, baseline: bool}. */
  nights: z.array(z.object({ date: z.string(), kwh: z.number(), baseline: z.boolean() })),
});
export type SavingsFloor = z.infer<typeof SavingsFloorSchema>;
export type SavingsReport = z.infer<typeof SavingsReportSchema>;

export const FinancialCategorySchema = z.object({
  category: z.string(),
  assets: z.number().int(),
  purchaseCost: z.number(),
  bookValue: z.number(),
  annualDepreciation: z.number(),
});
export const FinancialsReportSchema = z.object({
  currency: z.string(),
  asOf: z.string(),
  categories: z.array(FinancialCategorySchema),
  totals: FinancialCategorySchema.omit({ category: true }),
});
export type FinancialCategory = z.infer<typeof FinancialCategorySchema>;
export type FinancialsReport = z.infer<typeof FinancialsReportSchema>;

export const CalendarItemSchema = z.object({
  date: z.string(),
  kind: z.enum(['warranty_end', 'end_of_life', 'holiday']),
  assetId: IdSchema.nullable(),
  code: z.string().nullable(),
  name: z.string(),
  daysFromNow: z.number().int(),
});
export const CalendarResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  items: z.array(CalendarItemSchema),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;
