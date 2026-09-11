import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { CalendarResponseSchema, type MeResponse } from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent } from '~/components/ui/card';
import { api } from '~/lib/api';
import { formatDate } from '~/lib/format';

const KIND_VARIANT = {
  warranty_end: 'warning',
  end_of_life: 'destructive',
  holiday: 'secondary',
} as const;

export default function CalendarRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const query = useQuery({
    queryKey: ['calendar'],
    queryFn: () => api.get('/calendar', CalendarResponseSchema),
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
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-4" data-testid="calendar-page">
      <div>
        <h1 className="text-xl font-semibold">{t('calendar.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {r
            ? t('calendar.subtitle', { from: formatDate(r.from, l), to: formatDate(r.to, l) })
            : t('app.loading')}
        </p>
      </div>
      {r && r.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <CalendarDays className="size-6" aria-hidden />
            {t('calendar.empty')}
          </CardContent>
        </Card>
      )}
      {r && r.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {r.items.map((i, idx) => (
                <li
                  key={`${i.kind}-${i.assetId ?? i.date}-${idx}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  data-testid="calendar-item"
                  data-kind={i.kind}
                >
                  <span className="w-28 shrink-0 font-medium" dir="ltr">
                    {formatDate(i.date, l)}
                  </span>
                  <Badge variant={KIND_VARIANT[i.kind]}>{t(`calendar.kind.${i.kind}`)}</Badge>
                  {i.assetId ? (
                    <Link
                      to={assetDrawerLink(i.assetId)}
                      className="underline-offset-2 hover:underline"
                    >
                      <span dir="ltr">{i.code}</span> · {i.name}
                    </Link>
                  ) : (
                    <span>{i.name}</span>
                  )}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {t('calendar.inDays', { count: i.daysFromNow })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
