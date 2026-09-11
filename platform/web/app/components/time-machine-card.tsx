import { useMutation } from '@tanstack/react-query';
import { FastForward, History, Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CLOCK_SPEEDS, type ClockCommand } from '@platform/shared/clock';
import type { MeResponse } from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { isApiError } from '~/lib/api';
import {
  clockTimeInputValue,
  formatClockDate,
  formatClockTime,
  useBusinessClock,
  useClockCommand,
} from '~/lib/clock';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Console card for the time machine: jump forward by a duration, jump to a wall-clock time in the
 * tenant zone, change the speed, pause, or return to the real clock.
 */
export function TimeMachineCard({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const clock = useBusinessClock({ demoMode: true, timeZone: me.tenant.timeZone });
  const send = useClockCommand();
  const [time, setTime] = useState('20:00');
  const [tomorrow, setTomorrow] = useState(false);
  const command = useMutation({ mutationFn: (c: ClockCommand) => send(c) });
  const busy = command.isPending || !clock.ready;

  const jumpBy = (ms: number) => command.mutate({ op: 'jumpBy', ms });
  const speed = (value: number) => command.mutate({ op: 'speed', speed: value });

  return (
    <Card className="sm:col-span-2" data-testid="time-machine">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" aria-hidden /> {t('console.timeMachine')}
        </CardTitle>
        <CardDescription>{t('console.timeMachineHelp')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {clock.live ? t('clock.live') : t('clock.virtual')} ·{' '}
              {t('clock.zone', { zone: clock.timeZone })}
            </div>
            <div className="text-3xl font-semibold tabular-nums" dir="ltr" data-testid="tm-time">
              {formatClockTime(clock.now, clock.timeZone, i18n.language)}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatClockDate(clock.now, clock.timeZone, i18n.language)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!clock.live && (
              <Badge variant="warning">
                {clock.speed === 0 ? t('clock.paused') : t('clock.speed', { speed: clock.speed })}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || clock.live}
              onClick={() => command.mutate({ op: 'reset' })}
            >
              <RotateCcw aria-hidden /> {t('console.backToLive')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t('console.fastForward')}</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => jumpBy(10 * MINUTE)}
            >
              +10 {t('console.minutesShort')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => jumpBy(30 * MINUTE)}
            >
              +30 {t('console.minutesShort')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => jumpBy(HOUR)}>
              +1 {t('console.hourShort')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => jumpBy(DAY)}>
              +1 {t('console.dayShort')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tm-jump-time">{t('console.jumpToTime')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="tm-jump-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-32"
              dir="ltr"
            />
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={tomorrow}
                onChange={(e) => setTomorrow(e.target.checked)}
              />
              {t('console.tomorrow')}
            </label>
            <Button
              size="sm"
              disabled={busy || !/^\d{2}:\d{2}$/.test(time)}
              onClick={() =>
                command.mutate({ op: 'jumpToTime', time, dayOffset: tomorrow ? 1 : 0 })
              }
            >
              {t('console.jump')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setTime(clockTimeInputValue(clock.now, clock.timeZone))}
            >
              {t('console.useCurrent')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t('console.speed')}</Label>
          <div className="flex flex-wrap gap-2">
            {CLOCK_SPEEDS.map((s) => (
              <Button
                key={s}
                variant={clock.speed === s ? 'default' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => speed(s)}
              >
                {s === 1 ? <Play aria-hidden /> : <FastForward aria-hidden />}
                {s}×
              </Button>
            ))}
            <Button
              variant={clock.speed === 0 ? 'default' : 'outline'}
              size="sm"
              disabled={busy}
              onClick={() => speed(0)}
            >
              <Pause aria-hidden /> {t('console.pause')}
            </Button>
          </div>
        </div>

        {command.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {isApiError(command.error)
                ? (command.error.detail ?? command.error.title)
                : String(command.error)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
