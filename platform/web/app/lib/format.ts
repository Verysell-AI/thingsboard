import type { TFunction } from 'i18next';

/**
 * Human formatting for telemetry keys. Units come from the MQTT contract (context §5.3); anything
 * unknown is shown as-is so new keys never disappear from the UI.
 */
interface KeyFormat {
  labelKey: string;
  format: (v: number | string | boolean, t: TFunction, locale: string) => string;
}

const num = (locale: string, digits: number) => (v: number) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);

const KEY_FORMATS: Record<string, KeyFormat> = {
  power_w: {
    labelKey: 'telemetry.power_w',
    format: (v, _t, l) =>
      Number(v) >= 1000 ? `${num(l, 2)(Number(v) / 1000)} kW` : `${num(l, 0)(Number(v))} W`,
  },
  energy_kwh: {
    labelKey: 'telemetry.energy_kwh',
    format: (v, _t, l) => `${num(l, 3)(Number(v))} kWh`,
  },
  voltage_v: { labelKey: 'telemetry.voltage_v', format: (v, _t, l) => `${num(l, 1)(Number(v))} V` },
  current_a: { labelKey: 'telemetry.current_a', format: (v, _t, l) => `${num(l, 2)(Number(v))} A` },
  pf: { labelKey: 'telemetry.pf', format: (v, _t, l) => num(l, 3)(Number(v)) },
  room_temp_c: {
    labelKey: 'telemetry.room_temp_c',
    format: (v, _t, l) => `${num(l, 1)(Number(v))} °C`,
  },
  setpoint_c: {
    labelKey: 'telemetry.setpoint_c',
    format: (v, _t, l) => `${num(l, 1)(Number(v))} °C`,
  },
  runtime_h: { labelKey: 'telemetry.runtime_h', format: (v, _t, l) => `${num(l, 1)(Number(v))} h` },
  battery: { labelKey: 'telemetry.battery', format: (v, _t, l) => `${num(l, 0)(Number(v))} %` },
  cpu: { labelKey: 'telemetry.cpu', format: (v, _t, l) => `${num(l, 0)(Number(v))} %` },
  user: { labelKey: 'telemetry.user', format: (v) => String(v) },
  ap: { labelKey: 'telemetry.ap', format: (v) => String(v) },
  state: {
    labelKey: 'telemetry.state',
    format: (v, t) => (Number(v) === 1 ? t('status.on') : t('status.off')),
  },
  occupied: {
    labelKey: 'telemetry.occupied',
    format: (v, t) => (Number(v) === 1 ? t('status.occupied') : t('status.empty')),
  },
  count: {
    labelKey: 'telemetry.count',
    format: (v, t) => t('telemetry.people', { count: Number(v) }),
  },
};

/** Keys shown first in summaries, in this order. */
const PRIORITY = [
  'state',
  'power_w',
  'occupied',
  'count',
  'battery',
  'room_temp_c',
  'setpoint_c',
  'energy_kwh',
];

export function formatValue(
  key: string,
  value: number | string | boolean,
  t: TFunction,
  locale: string,
) {
  const f = KEY_FORMATS[key];
  return f ? f.format(value, t, locale) : String(value);
}

export function labelFor(key: string, t: TFunction): string {
  const f = KEY_FORMATS[key];
  return f ? t(f.labelKey) : key;
}

/** Ordered [key, label, formatted] triples for a values object. */
export function formatValues(
  values: Record<string, number | string | boolean>,
  t: TFunction,
  locale: string,
): Array<{ key: string; label: string; text: string }> {
  const keys = Object.keys(values).sort((a, b) => {
    const ia = PRIORITY.indexOf(a);
    const ib = PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((key) => ({
    key,
    label: labelFor(key, t),
    text: formatValue(key, values[key] as number | string | boolean, t, locale),
  }));
}

/** Short one-line summary such as "On · 440 W · 0.32 kWh". */
export function summarizeValues(
  values: Record<string, number | string | boolean>,
  t: TFunction,
  locale: string,
  max = 3,
): string {
  return formatValues(values, t, locale)
    .slice(0, max)
    .map((v) => v.text)
    .join(' · ');
}

export function formatPowerW(value: number | undefined, locale: string): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value >= 1000
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000)} kW`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} W`;
}

/** "12 s ago" style relative time; falls back to a clock time beyond an hour. */
export function formatAgo(
  ts: number | null | undefined,
  t: TFunction,
  locale: string,
  now = Date.now(),
): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('time.secondsAgo', { count: s });
  if (s < 3600) return t('time.minutesAgo', { count: Math.round(s / 60) });
  return new Date(ts).toLocaleTimeString(locale);
}

/** Money in the tenant currency, no decimals above 100. */
export function formatMoney(
  value: number | null | undefined,
  currency: string,
  locale: string,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

export function formatKwh(value: number | null | undefined, locale: string, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} kWh`;
}

/** Calendar date (YYYY-MM-DD or ISO) in the locale, no time. */
export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(value.length === 10 ? { timeZone: 'UTC' } : {}),
  }).format(new Date(ms));
}

/** Date and time in the tenant zone. */
export function formatDateTime(
  value: string | number | null | undefined,
  locale: string,
  timeZone: string,
): string {
  if (value === null || value === undefined) return '—';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(ms)) return String(value);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}
