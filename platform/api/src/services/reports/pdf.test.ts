import { describe, expect, it } from 'vitest';
import type { Report } from '@platform/shared/dto';
import { defaultBrand } from '../tenants/tenants.service.js';
import { PdfService, money, planForRegister, planForReport } from './pdf.service.js';

const brand = { ...defaultBrand('Falcon Facilities Group'), primaryColor: '#0B3D91' };

describe('report plans', () => {
  it('lays out a savings snapshot with stats and a floor table', () => {
    const report: Report = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'savings',
      period: '2026-08',
      generatedAt: new Date(0).toISOString(),
      pdfPath: null,
      data: {
        currency: 'AED',
        baselineWeeks: 8,
        recentWeeks: 4,
        automationSince: '2026-08-13',
        floors: [
          {
            floor: 1,
            baselineNightKwh: 25.5,
            recentNightKwh: 12.6,
            savedKwhPerNight: 12.9,
            savedPct: 0.506,
          },
        ],
        totalSavedKwh: 456.2,
        totalSavedCost: 200.72,
        nights: [{ date: '2026-08-14', kwh: 12, baseline: false }],
      },
    };
    const plan = planForReport(report, 'AED');
    expect(plan.title).toBe('Savings versus baseline · 2026-08');
    expect(plan.sections[0]!.stats!.map((s) => s.value)).toEqual(['456.2 kWh', 'AED 200.72', '1']);
    expect(plan.sections[1]!.table!.rows[0]).toEqual([
      'Floor 1',
      '25.5 kWh',
      '12.6 kWh',
      '12.9 kWh',
      '51 %',
    ]);
    expect(money(177550, 'AED')).toBe('AED 177,550.00');
  });

  it('summarises the register', () => {
    const plan = planForRegister(
      [
        {
          code: 'AC-1.1',
          name: 'AC 1.1',
          type: 'ac',
          location: { code: '1.1' },
          custodian: null,
          purchaseCost: 2400,
          bookValue: 1572.62,
        },
        {
          code: 'LAPTOP-E001',
          name: 'Laptop',
          type: 'laptop',
          location: null,
          custodian: { name: 'Amira Haddad' },
          purchaseCost: 5200,
          bookValue: null,
        },
      ] as never,
      'AED',
      '2026-09-10',
    );
    expect(plan.sections[0]!.stats![1]).toEqual({ label: 'Purchase cost', value: 'AED 7,600.00' });
    expect(plan.sections[1]!.table!.rows[1]).toEqual([
      'LAPTOP-E001',
      'Laptop',
      'laptop',
      '',
      'Amira Haddad',
      '5200',
      '',
    ]);
  });
});

describe('PdfService', () => {
  it('renders a branded PDF document', async () => {
    const pdf = await new PdfService(() => 0).render(brand, {
      title: 'Morning report 2026-09-09',
      subtitle: 'Test',
      sections: [
        { stats: [{ label: 'Rooms switched off', value: '2' }] },
        {
          heading: 'Rooms kept on',
          table: {
            columns: [
              { label: 'Room', width: 100 },
              { label: 'Reason', width: 200 },
            ],
            rows: [
              ['1.1', 'laptop online'],
              ['Total', '1'],
            ],
          },
        },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
    const text = pdf.toString('latin1');
    expect(text).toContain('/Type /Font');
    expect(text).toContain('/Title');
  });
});
