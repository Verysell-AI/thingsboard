import { zonedDayKey } from '@platform/shared/clock';
import {
  bookValueOf,
  type CalendarItem,
  type CalendarResponse,
  type FinancialCategory,
  type FinancialsReport,
} from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';

const DAY_MS = 24 * 3_600_000;
export const CALENDAR_DAYS = 90;

/** Straight-line yearly depreciation; null without cost or life. Pure. */
export function annualDepreciation(cost: number | null, lifeYears: number | null): number | null {
  if (cost === null || !lifeYears) return null;
  return Math.round((cost / lifeYears) * 100) / 100;
}

/** End of useful life as YYYY-MM-DD. Pure. */
export function endOfLifeDate(
  purchaseDate: string | null,
  lifeYears: number | null,
): string | null {
  if (!purchaseDate || !lifeYears) return null;
  const d = new Date(`${purchaseDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + lifeYears);
  return d.toISOString().slice(0, 10);
}

/** Days from `now` (zone date) to an ISO date; negative when past. Pure. */
export function daysUntil(date: string, now: number, timeZone: string): number {
  const today = Date.parse(`${zonedDayKey(now, timeZone)}T00:00:00Z`);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY_MS);
}

/** Book values, depreciation and the lifecycle calendar over the asset register. */
export class DepreciationService {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
  ) {}

  async financials(
    tenant: { id: string; currency: string },
    now: number,
  ): Promise<FinancialsReport> {
    const rows = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({
          category: assets.category,
          purchaseCost: assets.purchaseCost,
          purchaseDate: assets.purchaseDate,
          usefulLifeYears: assets.usefulLifeYears,
          status: assets.status,
        })
        .from(assets),
    );
    const groups = new Map<string, FinancialCategory>();
    for (const r of rows) {
      if (r.status === 'RETIRED') continue;
      const key = r.category ?? 'Uncategorised';
      const g = groups.get(key) ?? {
        category: key,
        assets: 0,
        purchaseCost: 0,
        bookValue: 0,
        annualDepreciation: 0,
      };
      const cost = r.purchaseCost === null ? null : Number(r.purchaseCost);
      g.assets += 1;
      g.purchaseCost += cost ?? 0;
      g.bookValue += bookValueOf(cost, r.purchaseDate, r.usefulLifeYears, now) ?? 0;
      g.annualDepreciation += annualDepreciation(cost, r.usefulLifeYears) ?? 0;
      groups.set(key, g);
    }
    const categories = [...groups.values()]
      .map((g) => ({
        ...g,
        purchaseCost: round2(g.purchaseCost),
        bookValue: round2(g.bookValue),
        annualDepreciation: round2(g.annualDepreciation),
      }))
      .sort((a, b) => b.purchaseCost - a.purchaseCost);
    const totals = categories.reduce(
      (t, g) => ({
        assets: t.assets + g.assets,
        purchaseCost: round2(t.purchaseCost + g.purchaseCost),
        bookValue: round2(t.bookValue + g.bookValue),
        annualDepreciation: round2(t.annualDepreciation + g.annualDepreciation),
      }),
      { assets: 0, purchaseCost: 0, bookValue: 0, annualDepreciation: 0 },
    );
    return { currency: tenant.currency, asOf: zonedDayKey(now, this.timeZone), categories, totals };
  }

  async calendar(
    tenant: { id: string },
    now: number,
    holidays: string[],
    days = CALENDAR_DAYS,
  ): Promise<CalendarResponse> {
    const rows = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({
          id: assets.id,
          code: assets.code,
          name: assets.name,
          purchaseDate: assets.purchaseDate,
          usefulLifeYears: assets.usefulLifeYears,
          warrantyEnd: assets.warrantyEnd,
          status: assets.status,
        })
        .from(assets),
    );
    const from = zonedDayKey(now, this.timeZone);
    const to = zonedDayKey(now + days * DAY_MS, this.timeZone);
    const items: CalendarItem[] = [];
    const push = (
      date: string | null,
      kind: CalendarItem['kind'],
      asset: { id: string; code: string; name: string } | null,
      name: string,
    ) => {
      if (!date || date < from || date > to) return;
      items.push({
        date,
        kind,
        assetId: asset?.id ?? null,
        code: asset?.code ?? null,
        name,
        daysFromNow: daysUntil(date, now, this.timeZone),
      });
    };
    for (const r of rows) {
      if (r.status === 'RETIRED') continue;
      push(r.warrantyEnd, 'warranty_end', r, `${r.name} warranty ends`);
      push(
        endOfLifeDate(r.purchaseDate, r.usefulLifeYears),
        'end_of_life',
        r,
        `${r.name} end of life`,
      );
    }
    for (const h of holidays) push(h, 'holiday', null, 'Holiday');
    items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    return { from, to, items };
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
