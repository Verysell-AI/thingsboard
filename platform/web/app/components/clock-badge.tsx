import { Clock, FastForward, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MeResponse } from '@platform/shared/dto';
import { Badge } from '~/components/ui/badge';
import { formatClockDate, formatClockTime, useBusinessClock } from '~/lib/clock';
import { cn } from '~/lib/utils';

/**
 * Header clock in the tenant's zone (Dubai for the demo). Shows the business clock: real time for
 * ordinary tenants, the time machine's virtual time for tenants in demo mode, with speed or pause
 * markers so an audience always knows which "now" the platform is acting on.
 */
export function ClockBadge({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const clock = useBusinessClock({
    demoMode: me.tenant.demoMode,
    timeZone: me.tenant.timeZone,
  });
  const time = formatClockTime(clock.now, clock.timeZone, i18n.language);
  const date = formatClockDate(clock.now, clock.timeZone, i18n.language);
  const marker = !clock.live ? (
    <Badge variant="warning" className="gap-1" data-testid="clock-marker">
      {clock.speed === 0 ? (
        <>
          <Pause className="size-3" aria-hidden /> {t('clock.paused')}
        </>
      ) : clock.speed !== 1 ? (
        <>
          <FastForward className="size-3" aria-hidden /> {t('clock.speed', { speed: clock.speed })}
        </>
      ) : (
        t('clock.virtual')
      )}
    </Badge>
  ) : null;

  const body = (
    <>
      <Clock
        className={cn('size-4 shrink-0', clock.live ? 'text-muted-foreground' : 'text-amber-600')}
        aria-hidden
      />
      <span className="flex flex-col leading-tight">
        <span className="font-semibold tabular-nums" data-testid="clock-time" dir="ltr">
          {time}
        </span>
        <span className="hidden text-[11px] text-muted-foreground sm:block">
          {date} · {t('clock.zone', { zone: clock.timeZone })}
        </span>
      </span>
      {marker}
    </>
  );

  const canOperate = me.tenant.demoMode && me.user.role === 'TENANT_ADMIN';
  const className = cn(
    'flex items-center gap-2 rounded-md px-2 py-1 text-sm',
    !clock.live && 'bg-amber-50 dark:bg-amber-950/40',
  );
  return canOperate ? (
    <Link to="/console" className={cn(className, 'hover:bg-muted')} title={t('clock.openConsole')}>
      {body}
    </Link>
  ) : (
    <div className={className} title={t('clock.zone', { zone: clock.timeZone })}>
      {body}
    </div>
  );
}
