import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { formatPowerW, formatValues, summarizeValues } from '~/lib/format';

const t = ((key: string, opts?: { count?: number }) =>
  key === 'telemetry.people'
    ? `${opts?.count} people`
    : key.split('.').pop()) as unknown as TFunction;

describe('telemetry formatting', () => {
  it('formats power in W below 1 kW and in kW above', () => {
    expect(formatPowerW(440.3, 'en')).toBe('440 W');
    expect(formatPowerW(4640.5, 'en')).toBe('4.64 kW');
    expect(formatPowerW(undefined, 'en')).toBe('—');
  });

  it('orders values with state and power first and adds units', () => {
    const rows = formatValues({ energy_kwh: 0.3218, power_w: 440.3, state: 1 }, t, 'en');
    expect(rows.map((r) => r.key)).toEqual(['state', 'power_w', 'energy_kwh']);
    expect(rows.map((r) => r.text)).toEqual(['on', '440 W', '0.322 kWh']);
  });

  it('summarises the first few values on one line', () => {
    expect(summarizeValues({ occupied: 1, count: 3 }, t, 'en')).toBe('occupied · 3 people');
  });
});
