import { describe, expect, it } from 'vitest';
import type { MorningReportData } from '@platform/shared/dto';
import { defaultBrand } from '../tenants/tenants.service.js';
import { renderMorningReportEmail } from '../../templates/email/morning-report.js';
import { reportDateFor, sweepSummaryFrom } from './morning-report.service.js';

const TZ = 'Asia/Dubai';

describe('reportDateFor', () => {
  it('covers the evening before when generated in the morning, today when run after noon', () => {
    // 07:00 Dubai on the 8th = 03:00 UTC
    expect(reportDateFor(Date.UTC(2026, 8, 8, 3, 0), TZ)).toBe('2026-09-07');
    // 15:00 Dubai on the 8th = 11:00 UTC (demo: sweep run by hand this afternoon)
    expect(reportDateFor(Date.UTC(2026, 8, 8, 11, 0), TZ)).toBe('2026-09-08');
  });
});

describe('sweepSummaryFrom', () => {
  it('reads a run summary and fills the measured values with null', () => {
    const s = sweepSummaryFrom({
      businessTime: 1,
      roomsOff: ['1.1', '1.2'],
      roomsSkipped: [
        { room: '1.O', reason: 'laptop_online', detail: 'Yusuf Rahman' },
        { room: '2.S', reason: 'critical_room' },
      ],
      commandsSent: 4,
      zonesKept: [{ zone: '1.West', employee: 'Yusuf Rahman' }],
      estimatedKwhSaved: 6.6,
      estimatedCostSaved: 2.9,
    });
    expect(s).toMatchObject({
      roomsOff: ['1.1', '1.2'],
      roomsSkipped: [
        { room: '1.O', reason: 'laptop_online', detail: 'Yusuf Rahman' },
        { room: '2.S', reason: 'critical_room', detail: null },
      ],
      measuredKwhSaved: null,
      measuredCostSaved: null,
    });
    expect(sweepSummaryFrom({ businessTime: 'not a number' })).toBeNull();
  });
});

describe('renderMorningReportEmail', () => {
  const brand = { ...defaultBrand('Falcon Facilities Group'), primaryColor: '#0B3D91' };
  const data: MorningReportData = {
    date: '2026-09-07',
    currency: 'AED',
    sweep: {
      businessTime: 1,
      roomsOff: ['1.1', '1.2', '1.3'],
      roomsSkipped: [{ room: '1.O', reason: 'laptop_online', detail: 'Yusuf Rahman' }],
      commandsSent: 6,
      zonesKept: [{ zone: '1.West', employee: 'Yusuf Rahman' }],
      estimatedKwhSaved: 6.6,
      estimatedCostSaved: 2.9,
      measuredKwhSaved: null,
      measuredCostSaved: null,
    },
    alarmsOvernight: 1,
    releasedBookings: 2,
    misplacedAssets: [{ code: 'LAPTOP-E003', room: '2.1' }],
    unreachableAssets: ['LAPTOP-E011'],
    emailedTo: [],
  };
  it('carries the brand, the numbers and the reasons, and nothing about the vendor', () => {
    const mail = renderMorningReportEmail(brand, data);
    expect(mail.subject).toBe('Morning report 2026-09-07: 3 rooms switched off, 6.6 kWh saved');
    expect(mail.html).toContain('#0B3D91');
    expect(mail.html).toContain('Falcon Facilities Group');
    expect(mail.html).toContain('AED 2.90');
    expect(mail.html).toContain('laptop online');
    expect(mail.html).toContain('Yusuf Rahman');
    expect(mail.html).toContain('LAPTOP-E011');
    expect(mail.html).toContain('LAPTOP-E003 in 2.1');
    expect(mail.html).toContain('estimated');
    expect(mail.html).not.toMatch(/thingsboard|verysell/i);
    expect(mail.text).toContain('Rooms off: 1.1, 1.2, 1.3');
  });
  it('says so when no sweep ran', () => {
    const mail = renderMorningReportEmail(brand, { ...data, sweep: null });
    expect(mail.subject).toContain('no evening sweep recorded');
    expect(mail.html).toContain('did not run');
  });
});
