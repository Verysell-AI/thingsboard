import { useTranslation } from 'react-i18next';
import type { AutomationRun } from '@platform/shared/dto';
import { Badge } from '~/components/ui/badge';
import { summarizeRun } from '~/lib/automations';
import { formatClockDate, formatClockTime } from '~/lib/clock';
import { formatDateTime } from '~/lib/format';

/** Compact rendering of what a run did: when, how many rooms, why rooms were skipped. */
export function RunSummary({
  run,
  timeZone,
  detailed = false,
}: {
  run: AutomationRun;
  timeZone: string;
  detailed?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const s = summarizeRun(run);
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="run-summary">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span dir="ltr">
          {s.businessTime !== null
            ? `${formatClockDate(s.businessTime, timeZone, l)} ${formatClockTime(s.businessTime, timeZone, l, { seconds: false })}`
            : formatDateTime(run.startedAt, l, timeZone)}
        </span>
        {s.trigger && (
          <Badge variant="outline">
            {t(`automations.trigger.${s.trigger}`, { defaultValue: s.trigger })}
          </Badge>
        )}
        {!run.finishedAt && <Badge variant="warning">{t('automations.running')}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('automations.summary.roomsOff')} value={s.roomsOff.length} />
        <Stat label={t('automations.summary.roomsSkipped')} value={s.roomsSkipped.length} />
        <Stat label={t('automations.summary.commands')} value={s.commandsSent} />
        <Stat label={t('automations.summary.released')} value={s.released} />
      </dl>
      {s.roomsOff.length > 0 && (
        <p className="text-xs">
          <span className="text-muted-foreground">{t('automations.summary.roomsOff')}: </span>
          <span dir="ltr">{s.roomsOff.join(', ')}</span>
        </p>
      )}
      {s.roomsSkipped.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {s.roomsSkipped.map((r, i) => (
            <li key={`${r.room}-${i}`}>
              <span dir="ltr" className="font-medium">
                {r.room}
              </span>{' '}
              · {t(`automations.reasons.${r.reason}`, { defaultValue: r.reason })}
            </li>
          ))}
        </ul>
      )}
      {detailed && s.decisions.length > 0 && (
        <div>
          <h4 className="mt-2 mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('automations.decisions')}
          </h4>
          <ul className="flex flex-col divide-y rounded-md border text-xs" dir="ltr">
            {s.decisions.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-2 py-1">
                <Badge
                  variant={
                    d.kind === 'command' ? 'accent' : d.kind === 'skip' ? 'secondary' : 'outline'
                  }
                >
                  {t(`automations.decisionKinds.${d.kind}`, { defaultValue: d.kind })}
                </Badge>
                {'room' in d && d.room && <span className="font-medium">{d.room}</span>}
                {d.kind === 'command' && (
                  <span>
                    {d.deviceCode} · {d.method} {JSON.stringify(d.params)}
                  </span>
                )}
                {d.kind === 'notify' && <span>{d.title}</span>}
                {d.kind === 'note' && <span>{d.message}</span>}
                {'reason' in d && d.reason && (
                  <span className="text-muted-foreground">
                    {t(`automations.reasons.${d.reason}`, { defaultValue: d.reason })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
