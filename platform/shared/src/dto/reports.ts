import { z } from 'zod';
import { IdSchema, PageQuerySchema, pageOf } from './common.js';

export const REPORT_KINDS = [
  'morning',
  'energy-cost',
  'savings',
  'asset-financials',
  'asset-register',
] as const;
export const ReportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKindSchema>;

/** One skipped room in a sweep summary. */
export const SweepSkipSchema = z.object({
  room: z.string(),
  reason: z.string(),
  /** Free text such as the laptop owner's name or the booking title. */
  detail: z.string().nullable().default(null),
});

/** Summary saved on the evening sweep's AutomationRun and reused by the morning report. */
export const SweepSummarySchema = z.object({
  /** Business time the sweep evaluated at (ms). */
  businessTime: z.number().int(),
  roomsOff: z.array(z.string()),
  roomsSkipped: z.array(SweepSkipSchema),
  commandsSent: z.number().int().min(0),
  zonesKept: z.array(z.object({ zone: z.string(), employee: z.string().nullable() })),
  estimatedKwhSaved: z.number(),
  estimatedCostSaved: z.number(),
  /** Filled by the morning report when overnight meter data and a baseline exist. */
  measuredKwhSaved: z.number().nullable().default(null),
  measuredCostSaved: z.number().nullable().default(null),
});
export type SweepSummary = z.infer<typeof SweepSummarySchema>;

export const MorningReportDataSchema = z.object({
  /** Local date the report covers (the evening before), YYYY-MM-DD. */
  date: z.string(),
  currency: z.string(),
  sweep: SweepSummarySchema.nullable(),
  alarmsOvernight: z.number().int().min(0),
  releasedBookings: z.number().int().min(0),
  misplacedAssets: z.array(z.object({ code: z.string(), room: z.string() })),
  unreachableAssets: z.array(z.string()),
  /** Recipients the branded email went to; empty when mail is not configured. */
  emailedTo: z.array(z.string()).default([]),
});
export type MorningReportData = z.infer<typeof MorningReportDataSchema>;

export const ReportSchema = z.object({
  id: IdSchema,
  kind: ReportKindSchema,
  /** Period label: a date (morning) or YYYY-MM (monthly reports). */
  period: z.string(),
  generatedAt: z.string(),
  pdfPath: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type Report = z.infer<typeof ReportSchema>;

export const ReportsQuerySchema = PageQuerySchema.extend({ kind: ReportKindSchema.optional() });
export const ReportsResponseSchema = pageOf(ReportSchema);
export type ReportsResponse = z.infer<typeof ReportsResponseSchema>;

/** Body of POST /reports/:kind/run: `period` defaults to the current business period. */
export const RunReportSchema = z.object({ period: z.string().optional() });
export type RunReport = z.infer<typeof RunReportSchema>;
