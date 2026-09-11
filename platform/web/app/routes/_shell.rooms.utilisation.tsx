import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import {
  UtilisationReportSchema,
  type MeResponse,
  type UtilisationRoom,
} from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Select } from '~/components/ui/select';
import { api } from '~/lib/api';

const HOURS = Array.from({ length: 13 }, (_, i) => 7 + i); // 07..19
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Background colour for an occupied share, from the brand accent at full strength. Pure. */
export function heatColour(share: number): string {
  const alpha = Math.max(0, Math.min(1, share));
  return `color-mix(in srgb, var(--brand-accent) ${Math.round(alpha * 100)}%, transparent)`;
}

export default function UtilisationRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [weeks, setWeeks] = useState(12);
  const query = useQuery({
    queryKey: ['rooms', 'utilisation', weeks],
    queryFn: () => api.get(`/rooms/utilisation?weeks=${weeks}`, UtilisationReportSchema),
    enabled: me.user.role !== 'FINANCE',
    staleTime: 5 * 60_000,
  });
  if (me.user.role === 'FINANCE')
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('reports.forbidden')}</AlertDescription>
      </Alert>
    );
  const r = query.data;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const dayName = (wd: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
      new Date(Date.UTC(2026, 8, 6 + wd, 12)),
    );
  return (
    <div className="flex flex-col gap-4" data-testid="utilisation-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('utilisation.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('utilisation.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(weeks)}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="w-36"
          >
            {[4, 8, 12].map((w) => (
              <option key={w} value={w}>
                {t('utilisation.weeks', { count: w })}
              </option>
            ))}
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link to="/rooms">{t('nav.rooms')}</Link>
          </Button>
        </div>
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {(r?.rooms ?? []).map((room) => (
          <RoomCard key={room.roomId} room={room} pct={pct} dayName={dayName} />
        ))}
      </div>
    </div>
  );
}

function RoomCard({
  room,
  pct,
  dayName,
}: {
  room: UtilisationRoom;
  pct: (v: number) => string;
  dayName: (wd: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="utilisation-room">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span dir="ltr">{room.code}</span> · {room.name}
          <Badge variant={room.utilisation < 0.2 ? 'warning' : 'success'}>
            {t('utilisation.used', { pct: pct(room.utilisation) })}
          </Badge>
          <Badge variant="outline">{t('utilisation.booked', { pct: pct(room.booked) })}</Badge>
          {room.ghostRate > 0 && (
            <Badge variant={room.ghostRate > 0.3 ? 'destructive' : 'secondary'}>
              {t('utilisation.ghost', { pct: pct(room.ghostRate) })}
            </Badge>
          )}
        </CardTitle>
        {room.recommendation && <CardDescription>{room.recommendation}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="text-xs" dir="ltr">
            <thead>
              <tr>
                <th className="pe-2 text-start font-normal text-muted-foreground" />
                {HOURS.map((h) => (
                  <th key={h} className="w-7 text-center font-normal text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((wd) => (
                <tr key={wd}>
                  <td className="pe-2 text-muted-foreground">{dayName(wd)}</td>
                  {HOURS.map((h) => {
                    const v = room.heatmap[wd]?.[h] ?? 0;
                    return (
                      <td key={h} className="p-0.5">
                        <div
                          className="h-6 w-6 rounded-sm border"
                          style={{ background: heatColour(v) }}
                          title={`${dayName(wd)} ${h}:00 · ${pct(v)}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
