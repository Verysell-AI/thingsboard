import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HoldSchema, HoldsResponseSchema, type MeResponse } from '@platform/shared/dto';
import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { api, isApiError } from '~/lib/api';
import { useBusinessClock } from '~/lib/clock';
import { formatDateTime } from '~/lib/format';

export const HOLDS_KEY = ['holds'] as const;
const FLOORS = ['1', '2'];

/** Business-time instant for "HH:MM" today in the tenant zone, or tomorrow when already past. Pure. */
export function holdUntil(now: number, time: string, timeZone: string): number {
  const [h, m] = time.split(':').map(Number);
  const parts = zonedDateParts(now, timeZone);
  let at = zonedTimeToEpoch({ ...parts, hour: h ?? 0, minute: m ?? 0, second: 0 }, timeZone);
  if (at <= now)
    at = zonedTimeToEpoch(
      { ...parts, day: parts.day + 1, hour: h ?? 0, minute: m ?? 0, second: 0 },
      timeZone,
    );
  return at;
}

/** "Event tonight": keep a floor on until a time; lists and removes the holds in force. */
export function HoldsCard({ me, canManage }: { me: MeResponse; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const clock = useBusinessClock({ demoMode: me.tenant.demoMode, timeZone: me.tenant.timeZone });
  const [floor, setFloor] = useState('1');
  const [time, setTime] = useState('23:00');
  const [reason, setReason] = useState('');
  const holds = useQuery({
    queryKey: HOLDS_KEY,
    queryFn: () => api.get('/holds', HoldsResponseSchema),
    refetchInterval: 60_000,
  });
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/holds',
        {
          scopeType: 'FLOOR',
          scopeId: floor,
          until: new Date(holdUntil(clock.now, time, me.tenant.timeZone)).toISOString(),
          reason: reason.trim() || t('automations.holds.defaultReason'),
        },
        HoldSchema,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HOLDS_KEY }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/holds/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HOLDS_KEY }),
  });
  const error = create.error ?? remove.error;
  return (
    <Card data-testid="holds-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" aria-hidden /> {t('automations.holds.title')}
        </CardTitle>
        <CardDescription>{t('automations.holds.help')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="hold-floor">{t('automations.holds.floor')}</Label>
              <Select id="hold-floor" value={floor} onChange={(e) => setFloor(e.target.value)}>
                {FLOORS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hold-until">{t('automations.holds.until')}</Label>
              <Input
                id="hold-until"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hold-reason">{t('automations.holds.reason')}</Label>
              <Input
                id="hold-reason"
                value={reason}
                placeholder={t('automations.holds.defaultReason')}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={create.isPending || !clock.ready}
              data-testid="create-hold"
            >
              {t('automations.holds.create')}
            </Button>
          </form>
        )}
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('automations.holds.active')}
          </h3>
          {(holds.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('automations.holds.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {(holds.data?.items ?? []).map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2" data-testid="hold">
                  <span className="font-medium">
                    {t(`automations.holds.scope.${h.scopeType}`)} <span dir="ltr">{h.scopeId}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {t('automations.until')}{' '}
                    {formatDateTime(h.until, i18n.language, me.tenant.timeZone)}
                  </span>
                  <span className="truncate text-muted-foreground">{h.reason}</span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ms-auto"
                      aria-label={t('automations.holds.remove')}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(h.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {isApiError(error) ? (error.detail ?? error.title) : String(error)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
