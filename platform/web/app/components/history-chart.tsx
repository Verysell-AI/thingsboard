import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '@platform/shared/dto';
import { formatClockTime } from '~/lib/clock';
import { formatValue, labelFor } from '~/lib/format';

const SERIES_COLOURS = ['var(--brand-accent)', '#0f766e', '#b45309', '#7c3aed'];

export interface HistoryChartProps {
  series: Record<string, SeriesPoint[]>;
  timeZone: string;
  height?: number;
  /** Show hours only (24 h view) or day + hour (longer ranges). */
  dense?: boolean;
}

/** Line chart over telemetry keys; one y-axis per key when the scales differ (left/right). */
export function HistoryChart({ series, timeZone, height = 220, dense }: HistoryChartProps) {
  const { t, i18n } = useTranslation();
  const keys = Object.keys(series).filter((k) => series[k]!.length > 0);
  if (keys.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('charts.noData')}</p>;
  }
  const byTs = new Map<number, Record<string, number>>();
  for (const key of keys) {
    for (const p of series[key]!) {
      const row = byTs.get(p.ts) ?? { ts: p.ts };
      row[key] = p.value;
      byTs.set(p.ts, row);
    }
  }
  const data = [...byTs.values()].sort((a, b) => a.ts! - b.ts!);
  const tick = (ms: number) =>
    dense
      ? new Intl.DateTimeFormat(i18n.language, {
          timeZone,
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(ms))
      : formatClockTime(ms, timeZone, i18n.language, { seconds: false });

  return (
    <div style={{ height }} dir="ltr" data-testid="history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tick}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            minTickGap={40}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6b7280' }} width={48} />
          {keys.length > 1 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              width={48}
            />
          )}
          <Tooltip
            labelFormatter={(v) => tick(Number(v))}
            formatter={(value, name) => [
              formatValue(String(name), Number(value), t, i18n.language),
              labelFor(String(name), t),
            ]}
          />
          {keys.map((key, i) => (
            <Line
              key={key}
              yAxisId={i === 0 ? 'left' : 'right'}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
