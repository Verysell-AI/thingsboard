import PDFDocument from 'pdfkit';
import {
  MorningReportDataSchema,
  type Asset,
  type EnergyCostReport,
  type FinancialsReport,
  type Report,
  type SavingsReport,
} from '@platform/shared/dto';
import type { TenantBrand, TenantRow } from '../../db/schema/index.js';

type Doc = InstanceType<typeof PDFDocument>;

const PAGE = { width: 595.28, height: 841.89, margin: 40 } as const; // A4 portrait
const HEADER_H = 64;
const FOOTER_H = 30;

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

/** Hex colour → pdfkit accepts hex strings; falls back to a neutral when the brand value is odd. */
function colour(v: string | undefined, fallback: string): string {
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

/** Fixed-point money without Intl (pdfkit has Latin fonts only). Pure. */
export function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function kwh(value: number, digits = 1): string {
  return `${value.toFixed(digits)} kWh`;
}

/** Lines of the report body, for tests and the brand audit: the same text the PDF draws. */
export interface PdfPlan {
  title: string;
  subtitle: string;
  sections: {
    heading?: string;
    stats?: { label: string; value: string }[];
    paragraph?: string;
    table?: { columns: Column[]; rows: string[][] };
  }[];
}

/** Turns a stored report into a print plan. Pure. */
export function planForReport(report: Report, currency: string): PdfPlan {
  switch (report.kind) {
    case 'morning': {
      const parsed = MorningReportDataSchema.safeParse(report.data);
      const d = parsed.success ? parsed.data : null;
      const s = d?.sweep ?? null;
      return {
        title: `Morning report ${report.period}`,
        subtitle: 'What the evening sweep switched off, what it kept on and why, and the night.',
        sections: [
          {
            stats: s
              ? [
                  { label: 'Rooms switched off', value: String(s.roomsOff.length) },
                  { label: 'Rooms kept on', value: String(s.roomsSkipped.length) },
                  {
                    label: s.measuredKwhSaved === null ? 'Estimated saving' : 'Measured saving',
                    value: kwh(s.measuredKwhSaved ?? s.estimatedKwhSaved),
                  },
                  {
                    label: 'Cost saved',
                    value: money(
                      s.measuredCostSaved ?? s.estimatedCostSaved,
                      d?.currency ?? currency,
                    ),
                  },
                ]
              : [{ label: 'Evening sweep', value: 'did not run' }],
          },
          ...(s && s.roomsSkipped.length
            ? [
                {
                  heading: 'Rooms kept on',
                  table: {
                    columns: [
                      { label: 'Room', width: 80 },
                      { label: 'Reason', width: 180 },
                      { label: 'Detail', width: 255 },
                    ],
                    rows: s.roomsSkipped.map((r) => [
                      r.room,
                      r.reason.replace(/_/g, ' '),
                      r.detail ?? '',
                    ]),
                  },
                },
              ]
            : []),
          {
            heading: 'Overnight',
            table: {
              columns: [
                { label: 'Item', width: 260 },
                { label: 'Value', width: 255 },
              ],
              rows: [
                ['Alarms', String(d?.alarmsOvernight ?? 0)],
                ['Ghost bookings released', String(d?.releasedBookings ?? 0)],
                ['Unreachable assets', d?.unreachableAssets.join(', ') || 'none'],
                [
                  'Misplaced assets',
                  d?.misplacedAssets.map((m) => `${m.code} in ${m.room}`).join(', ') || 'none',
                ],
              ],
            },
          },
        ],
      };
    }
    case 'energy-cost': {
      const r = report.data as unknown as EnergyCostReport;
      return {
        title: `Energy cost per department · ${report.period}`,
        subtitle: `Tariff ${r.currency} ${r.tariffPerKwh} per kWh. Open plans follow their people, meeting rooms their organisers, the rest is shared.`,
        sections: [
          {
            table: {
              columns: [
                { label: 'Department', width: 155 },
                ...r.months.map((m) => ({
                  label: m,
                  width: Math.floor(360 / Math.max(1, r.months.length)),
                  align: 'right' as const,
                })),
              ],
              rows: [
                ...r.departments.map((d) => [
                  d,
                  ...r.months.map((m) => {
                    const row = r.rows.find((x) => x.month === m && x.department === d);
                    return row ? `${money(row.cost, r.currency)} (${kwh(row.kwh, 0)})` : '—';
                  }),
                ]),
                [
                  'Total',
                  ...r.totals.map((t) => `${money(t.cost, r.currency)} (${kwh(t.kwh, 0)})`),
                ],
              ],
            },
          },
        ],
      };
    }
    case 'savings': {
      const r = report.data as unknown as SavingsReport;
      return {
        title: `Savings versus baseline · ${report.period}`,
        subtitle: `Night-time energy (20:00–07:00) per floor, ${r.baselineWeeks} weeks before automation (${r.automationSince}) against ${r.recentWeeks} weeks after.`,
        sections: [
          {
            stats: [
              { label: 'Saved so far', value: kwh(r.totalSavedKwh) },
              { label: 'Cost saved', value: money(r.totalSavedCost, r.currency) },
              {
                label: 'Measured nights',
                value: String(r.nights.filter((n) => !n.baseline).length),
              },
            ],
          },
          {
            table: {
              columns: [
                { label: 'Floor', width: 95 },
                { label: 'Baseline / night', width: 120, align: 'right' },
                { label: 'Now / night', width: 120, align: 'right' },
                { label: 'Saved / night', width: 110, align: 'right' },
                { label: '%', width: 70, align: 'right' },
              ],
              rows: r.floors.map((f) => [
                `Floor ${f.floor}`,
                kwh(f.baselineNightKwh),
                kwh(f.recentNightKwh),
                kwh(f.savedKwhPerNight),
                `${Math.round(f.savedPct * 100)} %`,
              ]),
            },
          },
        ],
      };
    }
    case 'asset-financials': {
      const r = report.data as unknown as FinancialsReport;
      return {
        title: `Asset financials · ${report.period}`,
        subtitle: `Straight-line depreciation from purchase cost and useful life, as of ${r.asOf}.`,
        sections: [
          {
            table: {
              columns: [
                { label: 'Category', width: 155 },
                { label: 'Assets', width: 60, align: 'right' },
                { label: 'Purchase cost', width: 105, align: 'right' },
                { label: 'Book value', width: 100, align: 'right' },
                { label: 'Depreciation / yr', width: 95, align: 'right' },
              ],
              rows: [
                ...r.categories.map((c) => [
                  c.category,
                  String(c.assets),
                  money(c.purchaseCost, r.currency),
                  money(c.bookValue, r.currency),
                  money(c.annualDepreciation, r.currency),
                ]),
                [
                  'Total',
                  String(r.totals.assets),
                  money(r.totals.purchaseCost, r.currency),
                  money(r.totals.bookValue, r.currency),
                  money(r.totals.annualDepreciation, r.currency),
                ],
              ],
            },
          },
        ],
      };
    }
    default:
      return {
        title: `${report.kind} · ${report.period}`,
        subtitle: 'Report',
        sections: [{ paragraph: JSON.stringify(report.data).slice(0, 2000) }],
      };
  }
}

/** The asset register as a print plan. Pure. */
export function planForRegister(items: Asset[], currency: string, asOf: string): PdfPlan {
  const total = items.reduce((s, a) => s + (a.purchaseCost ?? 0), 0);
  const book = items.reduce((s, a) => s + (a.bookValue ?? 0), 0);
  return {
    title: 'Asset register',
    subtitle: `${items.length} assets as of ${asOf}.`,
    sections: [
      {
        stats: [
          { label: 'Assets', value: String(items.length) },
          { label: 'Purchase cost', value: money(total, currency) },
          { label: 'Book value', value: money(book, currency) },
        ],
      },
      {
        table: {
          columns: [
            { label: 'Code', width: 95 },
            { label: 'Name', width: 120 },
            { label: 'Type', width: 60 },
            { label: 'Location', width: 70 },
            { label: 'Custodian', width: 80 },
            { label: 'Cost', width: 45, align: 'right' },
            { label: 'Book', width: 45, align: 'right' },
          ],
          rows: items.map((a) => [
            a.code,
            a.name,
            a.type,
            a.location?.code ?? '',
            a.custodian?.name ?? '',
            a.purchaseCost === null ? '' : a.purchaseCost.toFixed(0),
            a.bookValue === null ? '' : a.bookValue.toFixed(0),
          ]),
        },
      },
    ],
  };
}

/**
 * Branded PDFs drawn with pdfkit (Latin fonts only, so Arabic text is not rendered): a colour band
 * with the tenant name, the title, stat tiles and tables, a footer with tenant, date and page number.
 * No browser is needed in the API container.
 */
export class PdfService {
  constructor(private readonly now: () => number = Date.now) {}

  render(brand: TenantBrand, plan: PdfPlan): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: HEADER_H + 24,
          bottom: FOOTER_H + 16,
          left: PAGE.margin,
          right: PAGE.margin,
        },
        info: { Title: plan.title, Author: brand.name },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const primary = colour(brand.primaryColor, '#1f2937');
      const accent = colour(brand.accentColor, '#4b5563');
      const stamp = new Date(this.now()).toISOString().slice(0, 16).replace('T', ' ');
      let page = 0;
      const decorate = () => {
        page++;
        doc.save();
        doc.rect(0, 0, PAGE.width, HEADER_H).fill(primary);
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(brand.name, PAGE.margin, 20, { lineBreak: false });
        doc.font('Helvetica').fontSize(10).text(plan.title, PAGE.margin, 40, { lineBreak: false });
        doc
          .fillColor('#6b7280')
          .fontSize(8)
          .text(
            `${brand.name} · ${stamp} UTC · page ${page}`,
            PAGE.margin,
            PAGE.height - FOOTER_H,
            {
              width: PAGE.width - 2 * PAGE.margin,
              align: 'right',
              lineBreak: false,
            },
          );
        doc.restore();
        doc.fillColor('#111827').font('Helvetica').fontSize(10);
      };
      decorate();
      doc.on('pageAdded', decorate);

      doc.font('Helvetica-Bold').fontSize(18).fillColor(primary).text(plan.title);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(plan.subtitle);
      doc.moveDown(1);

      for (const section of plan.sections) {
        if (section.heading) {
          doc.moveDown(0.5);
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(section.heading);
          doc.moveDown(0.3);
        }
        if (section.stats?.length) this.stats(doc, section.stats, accent);
        if (section.paragraph) {
          doc.font('Helvetica').fontSize(10).fillColor('#111827').text(section.paragraph);
          doc.moveDown(0.5);
        }
        if (section.table) this.table(doc, section.table.columns, section.table.rows, primary);
      }
      doc.end();
    });
  }

  private stats(doc: Doc, stats: { label: string; value: string }[], accent: string) {
    const width = (PAGE.width - 2 * PAGE.margin - 8 * (stats.length - 1)) / stats.length;
    const y = doc.y;
    stats.forEach((s, i) => {
      const x = PAGE.margin + i * (width + 8);
      doc.save().rect(x, y, width, 44).fill('#f3f4f6').restore();
      doc
        .fillColor('#6b7280')
        .font('Helvetica')
        .fontSize(8)
        .text(s.label, x + 8, y + 7, { width: width - 16, lineBreak: false });
      doc
        .fillColor(accent)
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(s.value, x + 8, y + 20, { width: width - 16, lineBreak: false });
    });
    doc.y = y + 56;
    doc.x = PAGE.margin;
  }

  private table(doc: Doc, columns: Column[], rows: string[][], primary: string) {
    const rowH = 18;
    const drawHeader = () => {
      const y = doc.y;
      doc
        .save()
        .rect(PAGE.margin, y, PAGE.width - 2 * PAGE.margin, rowH)
        .fill(primary)
        .restore();
      let x = PAGE.margin;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      for (const c of columns) {
        doc.text(c.label, x + 4, y + 5, {
          width: c.width - 8,
          align: c.align ?? 'left',
          lineBreak: false,
        });
        x += c.width;
      }
      doc.y = y + rowH;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(9);
    rows.forEach((row, i) => {
      if (doc.y + rowH > PAGE.height - FOOTER_H - 20) {
        doc.addPage();
        drawHeader();
        doc.font('Helvetica').fontSize(9);
      }
      const y = doc.y;
      if (i % 2 === 1)
        doc
          .save()
          .rect(PAGE.margin, y, PAGE.width - 2 * PAGE.margin, rowH)
          .fill('#f9fafb')
          .restore();
      let x = PAGE.margin;
      const last = i === rows.length - 1 && row[0] === 'Total';
      doc.fillColor('#111827').font(last ? 'Helvetica-Bold' : 'Helvetica');
      row.forEach((cell, j) => {
        const c = columns[j]!;
        doc.text(cell, x + 4, y + 5, {
          width: c.width - 8,
          align: c.align ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += c.width;
      });
      doc.y = y + rowH;
    });
    doc.x = PAGE.margin;
    doc.moveDown(0.8);
  }
}

export function reportFilename(tenant: Pick<TenantRow, 'key'>, report: Report): string {
  return `${tenant.key}-${report.kind}-${report.period}.pdf`;
}
