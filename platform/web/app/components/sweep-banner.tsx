import { Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LiveEvent } from '@platform/shared/contracts';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { formatKwh } from '~/lib/format';

/** How long a finished sweep stays announced on the floor plan. */
export const SWEEP_BANNER_MS = 90_000;

export interface SweepBanner {
  status: 'started' | 'finished';
  roomsOff: number;
  roomsKept: number;
  estimatedKwhSaved: number | null;
}

/** The most recent evening-sweep run worth showing, from the live event list. Pure. */
export function sweepBannerFrom(events: LiveEvent[], now: number): SweepBanner | null {
  const e = events.find(
    (ev) =>
      ev.kind === 'automation.run' &&
      (ev.automationKey === 'evening_sweep' || ev.automationKey === 'holiday_mode'),
  );
  if (!e || e.kind !== 'automation.run') return null;
  if (now - e.ts > SWEEP_BANNER_MS) return null;
  if (e.status === 'started')
    return { status: 'started', roomsOff: 0, roomsKept: 0, estimatedKwhSaved: null };
  const summary = (e.summary ?? {}) as Record<string, unknown>;
  const roomsOff = Array.isArray(summary.roomsOff) ? summary.roomsOff.length : 0;
  const roomsKept = Array.isArray(summary.roomsSkipped) ? summary.roomsSkipped.length : 0;
  if (roomsOff === 0 && roomsKept === 0) return null; // a "not due" note, nothing to announce
  const kwh = typeof summary.estimatedKwhSaved === 'number' ? summary.estimatedKwhSaved : null;
  return { status: 'finished', roomsOff, roomsKept, estimatedKwhSaved: kwh };
}

/** Announces a running or just-finished evening sweep above the floor plan. */
export function SweepBannerView({ banner }: { banner: SweepBanner | null }) {
  const { t, i18n } = useTranslation();
  if (!banner) return null;
  return (
    <Alert variant="info" data-testid="sweep-banner" data-status={banner.status}>
      <Moon className="size-4" aria-hidden />
      <AlertDescription>
        {banner.status === 'started'
          ? t('automations.sweepBanner.running')
          : `${t('automations.sweepBanner.done', { off: banner.roomsOff, kept: banner.roomsKept })}${
              banner.estimatedKwhSaved !== null
                ? ` · ${t('automations.sweepBanner.saved', { kwh: formatKwh(banner.estimatedKwhSaved, i18n.language) })}`
                : ''
            }`}
      </AlertDescription>
    </Alert>
  );
}
