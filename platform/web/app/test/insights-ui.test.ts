import { describe, expect, it } from 'vitest';
import { chartRows } from '~/routes/_shell.reports.energy-cost';
import { heatColour } from '~/routes/_shell.rooms.utilisation';
import { csvCell, toCsv } from '~/lib/csv';

describe('csv', () => {
  it('quotes cells that need it and joins rows with CRLF', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [2, 'y,z'],
        ],
      ),
    ).toBe('a,b\r\n1,x\r\n2,"y,z"\r\n');
  });
});

describe('energy cost chart rows', () => {
  it('pivots rows into one object per month keyed by department', () => {
    expect(
      chartRows({
        currency: 'AED',
        tariffPerKwh: 0.44,
        months: ['2026-08', '2026-09'],
        departments: ['Sales', 'Shared'],
        rows: [
          { month: '2026-08', department: 'Sales', kwh: 10, cost: 4.4 },
          { month: '2026-08', department: 'Shared', kwh: 5, cost: 2.2 },
          { month: '2026-09', department: 'Sales', kwh: 2, cost: 0.88 },
        ],
        totals: [],
      }),
    ).toEqual([
      { month: '2026-08', Sales: 4.4, Shared: 2.2 },
      { month: '2026-09', Sales: 0.88 },
    ]);
  });
});

describe('heatColour', () => {
  it('maps the occupied share to the accent mix and clamps', () => {
    expect(heatColour(0)).toContain('0%');
    expect(heatColour(0.5)).toContain('50%');
    expect(heatColour(2)).toContain('100%');
  });
});
