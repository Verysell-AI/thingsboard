import { and, eq } from 'drizzle-orm';
import { zonedDateParts } from '@platform/shared/clock';
import type { Report } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { reports, type TenantRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { DepreciationService } from '../assets/depreciation.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { AllocationService } from '../energy/allocation.service.js';
import { monthKeys } from '../energy/allocation.service.js';
import { emailLayout, esc } from '../../templates/email/layout.js';
import type { Mailer } from './mail.service.js';
import { toReportDto } from './morning-report.service.js';
import { reportFilename, planForReport, type PdfService } from './pdf.service.js';
import { operationsRecipients } from './recipients.js';
import type { SavingsService } from './savings.service.js';

export const MONTHLY_KINDS = ['energy-cost', 'savings', 'asset-financials'] as const;
export type MonthlyKind = (typeof MONTHLY_KINDS)[number];

/** Month before the one containing `now`, as YYYY-MM. Pure. */
export function previousMonth(now: number, timeZone: string): string {
  return monthKeys(now, 2, timeZone)[0]!;
}

/**
 * Monthly report snapshots (energy cost per department, savings versus baseline, asset
 * financials) stored as `Report` rows: produced by the automation tick on the first business day
 * of a month for the month before, or on demand for any period.
 */
export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly allocation: AllocationService,
    private readonly savings: SavingsService,
    private readonly depreciation: DepreciationService,
    private readonly timeZone: string,
    private readonly realNow: () => number = Date.now,
    private readonly mailer: Mailer | null = null,
    private readonly pdf: PdfService | null = null,
  ) {}

  private tenantView(t: TenantRow) {
    return { id: t.id, key: t.key, currency: t.currency, tariffPerKwh: Number(t.tariffPerKwh) };
  }

  async generate(
    tenant: TenantRow,
    kind: MonthlyKind,
    opts: { period?: string; trigger: string },
  ): Promise<Report> {
    if (!MONTHLY_KINDS.includes(kind)) throw badRequest(`Unknown report kind ${kind}`);
    const now = await this.clock.now(tenant.key);
    const period = opts.period ?? monthKeys(now, 1, this.timeZone)[0]!;
    if (!/^\d{4}-\d{2}$/.test(period)) throw badRequest('period must be YYYY-MM');
    const view = this.tenantView(tenant);
    const data: Record<string, unknown> =
      kind === 'energy-cost'
        ? { ...(await this.allocation.report(view, 3, now)), period }
        : kind === 'savings'
          ? { ...(await this.savings.report(view, now)), period }
          : { ...(await this.depreciation.financials(view, now)), period };
    const row = await withTenant(this.db, tenant.id, async (tx) => {
      await tx.delete(reports).where(and(eq(reports.kind, kind), eq(reports.period, period)));
      const [inserted] = await tx
        .insert(reports)
        .values({
          tenantId: tenant.id,
          kind,
          period,
          generatedAt: new Date(this.realNow()),
          data: { ...data, trigger: opts.trigger },
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'report.generate',
        entityType: 'report',
        entityId: inserted!.id,
        after: { kind, period, trigger: opts.trigger },
      });
      return inserted!;
    });
    return toReportDto(row);
  }

  /** On the first business day of a month, snapshots the month before once and emails them. */
  async dueCheck(tenant: TenantRow, now: number): Promise<Report[]> {
    if (zonedDateParts(now, this.timeZone).day !== 1) return [];
    const period = previousMonth(now, this.timeZone);
    const out: Report[] = [];
    for (const kind of MONTHLY_KINDS) {
      const existing = await withTenant(this.db, tenant.id, (tx) =>
        tx
          .select({ id: reports.id })
          .from(reports)
          .where(and(eq(reports.kind, kind), eq(reports.period, period)))
          .limit(1),
      );
      if (existing.length) continue;
      out.push(await this.generate(tenant, kind, { period, trigger: 'schedule' }));
    }
    if (out.length) await this.email(tenant, period, out).catch(() => undefined);
    return out;
  }

  /** Branded monthly mail to operations with the snapshots attached as PDFs. */
  async email(tenant: TenantRow, period: string, snapshots: Report[]): Promise<string[]> {
    if (!this.mailer || !this.pdf) return [];
    const to = await operationsRecipients(this.db, tenant.id);
    if (to.length === 0) return [];
    const attachments = [];
    for (const r of snapshots)
      attachments.push({
        filename: reportFilename(tenant, r),
        content: await this.pdf.render(tenant.brand, planForReport(r, tenant.currency)),
        contentType: 'application/pdf',
      });
    const list = snapshots.map((r) => `<li>${esc(r.kind)} · ${esc(r.period)}</li>`).join('');
    await this.mailer.send({
      to,
      subject: `Monthly reports ${period}`,
      html: emailLayout(
        tenant.brand,
        `Monthly reports · ${period}`,
        `<p style="margin:0 0 12px">The month's reports are attached as PDF:</p><ul style="margin:0 0 16px;padding-left:20px">${list}</ul>`,
      ),
      text: `Monthly reports ${period}: ${snapshots.map((r) => r.kind).join(', ')} attached.`,
      attachments,
    });
    return to;
  }
}
