import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarX,
  Flame,
  Laptop,
  LogOut,
  Moon,
  MoveRight,
  Sun,
  UserRoundCheck,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import type { LiveEvent } from '@platform/shared/contracts';
import {
  AutomationRunSchema,
  EmployeesResponseSchema,
  LocationsResponseSchema,
  ReportSchema,
  ScenarioResultSchema,
  type MeResponse,
  type ScenarioName,
  type ScenarioParams,
  type ScenarioResult,
} from '@platform/shared/dto';
import { TimeMachineCard } from '~/components/time-machine-card';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { api, isApiError } from '~/lib/api';
import { summarizeValues } from '~/lib/format';
import { useLive } from '~/lib/live';
import { cn } from '~/lib/utils';

type LastResult =
  | { kind: 'result'; scenario: ScenarioName; result: ScenarioResult; status: number }
  | { kind: 'error'; scenario: ScenarioName; message: string };

export default function ConsoleRoute() {
  const { t } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const live = useLive();
  const [laptopCode, setLaptopCode] = useState('LAPTOP-E001');
  const [ghostRoom, setGhostRoom] = useState('1.4');
  const [moveCode, setMoveCode] = useState('LAPTOP-E003');
  const [moveRoom, setMoveRoom] = useState('2.1');
  const [lateEmployee, setLateEmployee] = useState('');
  const [heaterRoom, setHeaterRoom] = useState('1.P');
  const [last, setLast] = useState<LastResult | null>(null);
  const queryClient = useQueryClient();
  const rooms = useQuery({
    queryKey: ['locations', 'ROOM'],
    queryFn: () => api.get('/locations?type=ROOM', LocationsResponseSchema),
    staleTime: 5 * 60_000,
  });
  const meetingRooms = (rooms.data?.items ?? []).filter((r) => r.kind === 'meeting');
  const allRooms = rooms.data?.items ?? [];
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees', EmployeesResponseSchema),
    staleTime: 5 * 60_000,
  });
  const people = employees.data?.items ?? [];
  const lateRef = lateEmployee || people[0]?.code || '';
  const report = useMutation({
    mutationFn: () => api.post('/reports/morning/run', {}, ReportSchema),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reports'] }),
  });
  const automation = useMutation({
    mutationFn: (key: string) => api.post(`/automations/${key}/run`, {}, AutomationRunSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });

  const scenario = useMutation({
    mutationFn: async ({ name, params }: { name: ScenarioName; params: ScenarioParams }) => {
      // 501 carries a ScenarioResult body for scenarios the simulator does not implement yet.
      const body = await api.post<unknown>(`/console/scenario/${name}`, params, undefined, {
        acceptStatuses: [501],
      });
      const parsed = ScenarioResultSchema.safeParse(body);
      const result: ScenarioResult = parsed.success
        ? parsed.data
        : { scenario: name, accepted: false, message: t('console.notImplemented') };
      return { name, result, status: result.accepted ? 200 : 501 };
    },
    onSuccess: ({ name, result, status }) =>
      setLast({ kind: 'result', scenario: name, result, status }),
    onError: (e, { name }) =>
      setLast({
        kind: 'error',
        scenario: name,
        message: isApiError(e) ? (e.detail ?? e.title) : String(e),
      }),
  });

  if (me.user.role !== 'TENANT_ADMIN' || !me.tenant.demoMode) {
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('console.forbidden')}</AlertDescription>
      </Alert>
    );
  }

  const run = (name: ScenarioName, params: ScenarioParams = {}) =>
    scenario.mutate({ name, params });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{t('console.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('console.subtitle')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Laptop className="size-4" aria-hidden /> {t('console.firstBoot')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="laptop-code">{t('console.laptopCode')}</Label>
                <Input
                  id="laptop-code"
                  value={laptopCode}
                  onChange={(e) => setLaptopCode(e.target.value)}
                />
              </div>
              <Button
                disabled={scenario.isPending}
                onClick={() => run('new-laptop-first-boot', { code: laptopCode })}
              >
                {t('console.run')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LogOut className="size-4" aria-hidden /> {t('console.everyoneLeaves')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button disabled={scenario.isPending} onClick={() => run('everyone-leaves')}>
                {t('console.run')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sun className="size-4" aria-hidden /> {t('console.lunchPeak')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button disabled={scenario.isPending} onClick={() => run('lunch-peak')}>
                {t('console.run')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarX className="size-4" aria-hidden /> {t('console.ghostMeeting')}
              </CardTitle>
              <CardDescription>{t('console.ghostMeetingHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ghost-room">{t('assets.filters.room')}</Label>
                <Select
                  id="ghost-room"
                  value={ghostRoom}
                  onChange={(e) => setGhostRoom(e.target.value)}
                >
                  {meetingRooms.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                disabled={scenario.isPending}
                onClick={() => run('ghost-meeting', { room: ghostRoom })}
                data-testid="ghost-meeting"
              >
                {t('console.create')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MoveRight className="size-4 rtl:rotate-180" aria-hidden />{' '}
                {t('console.moveLaptop')}
              </CardTitle>
              <CardDescription>{t('console.moveLaptopHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="move-code">{t('console.laptopCode')}</Label>
                  <Input
                    id="move-code"
                    value={moveCode}
                    onChange={(e) => setMoveCode(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="move-room">{t('assets.filters.room')}</Label>
                  <Select
                    id="move-room"
                    value={moveRoom}
                    onChange={(e) => setMoveRoom(e.target.value)}
                  >
                    {allRooms.map((r) => (
                      <option key={r.id} value={r.code}>
                        {r.code} · {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <Button
                disabled={scenario.isPending}
                onClick={() => run('move-laptop', { code: moveCode, room: moveRoom })}
                data-testid="move-laptop"
              >
                {t('console.move')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundCheck className="size-4" aria-hidden /> {t('console.lateWorker')}
              </CardTitle>
              <CardDescription>{t('console.lateWorkerHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="late-employee">{t('console.employee')}</Label>
                <Select
                  id="late-employee"
                  value={lateRef}
                  onChange={(e) => setLateEmployee(e.target.value)}
                >
                  {people.map((p) => (
                    <option key={p.id} value={p.code}>
                      {p.name} · {p.code}
                      {p.zone ? ` · ${p.zone}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                disabled={scenario.isPending || !lateRef}
                onClick={() => run('late-worker-stays', { employeeId: lateRef })}
                data-testid="late-worker"
              >
                {t('console.run')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-4" aria-hidden /> {t('console.heater')}
              </CardTitle>
              <CardDescription>{t('console.heaterHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="heater-room">{t('assets.filters.room')}</Label>
                <Select
                  id="heater-room"
                  value={heaterRoom}
                  onChange={(e) => setHeaterRoom(e.target.value)}
                >
                  {allRooms.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                disabled={scenario.isPending}
                onClick={() => run('heater-left-on', { room: heaterRoom })}
                data-testid="heater-left-on"
              >
                {t('console.run')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="size-4" aria-hidden /> {t('console.automations')}
              </CardTitle>
              <CardDescription>{t('console.automationsHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={automation.isPending}
                onClick={() => automation.mutate('room_auto_off')}
                data-testid="run-auto-off"
              >
                {t('console.runAutoOff')}
              </Button>
              <Button
                variant="secondary"
                disabled={automation.isPending}
                onClick={() => automation.mutate('ghost_booking')}
                data-testid="run-ghost-check"
              >
                {t('console.checkGhost')}
              </Button>
              <Button
                disabled={automation.isPending}
                onClick={() => automation.mutate('evening_sweep')}
                data-testid="run-sweep"
              >
                <Moon aria-hidden /> {t('console.runSweep')}
              </Button>
              <Button
                variant="outline"
                disabled={report.isPending}
                onClick={() => report.mutate()}
                data-testid="run-morning-report"
              >
                {t('console.morningReport')}
              </Button>
              {report.isSuccess && (
                <p className="w-full text-xs text-muted-foreground" data-testid="report-result">
                  {t('console.morningReportDone', {
                    period: report.data.period,
                    mail:
                      Array.isArray(report.data.data.emailedTo) && report.data.data.emailedTo.length
                        ? t('console.mailedTo', {
                            to: (report.data.data.emailedTo as string[]).join(', '),
                          })
                        : '',
                  })}
                </p>
              )}
              {automation.isSuccess && (
                <p className="w-full text-xs text-muted-foreground" data-testid="automation-result">
                  {t('console.automationDone', {
                    name: t(`automations.names.${automation.data.key}`, {
                      defaultValue: automation.data.key,
                    }),
                  })}
                </p>
              )}
              {automation.isError && (
                <p className="w-full text-xs text-destructive">
                  {isApiError(automation.error)
                    ? (automation.error.detail ?? automation.error.title)
                    : String(automation.error)}
                </p>
              )}
            </CardContent>
          </Card>

          <TimeMachineCard me={me} />
        </div>

        {last && <LastResultView last={last} />}
      </div>

      <Card className="min-h-0 min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t('console.events')}
            <Badge variant={live.connected ? 'success' : 'secondary'}>
              {live.connected ? t('floor.live') : t('floor.offline')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {live.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('console.noEvents')}</p>
          ) : (
            <ul
              dir="ltr"
              className="flex max-h-[60vh] flex-col gap-1 overflow-auto text-start font-mono text-xs"
            >
              {live.events.slice(0, 20).map((e) => (
                <EventLineView key={e.id} line={describeEvent(e, t)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LastResultView({ last }: { last: LastResult }) {
  const { t } = useTranslation();
  if (last.kind === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {t('console.lastResult')} · {last.scenario}
        </AlertTitle>
        <AlertDescription>{last.message}</AlertDescription>
      </Alert>
    );
  }
  const variant = last.status === 501 ? 'info' : last.result.accepted ? 'success' : 'destructive';
  const badge =
    last.status === 501
      ? t('console.notImplemented')
      : last.result.accepted
        ? t('console.accepted')
        : t('console.rejected');
  return (
    <Alert variant={variant} data-testid="scenario-result">
      <AlertTitle className="flex items-center gap-2">
        {t('console.lastResult')} · {last.scenario}
        <Badge variant="outline">{badge}</Badge>
      </AlertTitle>
      <AlertDescription>
        {last.result.message}
        {last.result.details && (
          <pre className="mt-2 overflow-auto text-xs">
            {JSON.stringify(last.result.details, null, 2)}
          </pre>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface EventLine {
  time: string;
  tone: 'neutral' | 'online' | 'off' | 'alarm' | 'accent';
  kind: string;
  subject: string;
  summary: string;
  raw: string;
}

/** One readable line per live event: time, what happened, to which device, key values. */
function describeEvent(e: LiveEvent, t: TFunction): EventLine {
  const time = new Date(e.ts).toLocaleTimeString();
  const kind = t(`events.${e.kind}`);
  const raw = JSON.stringify('values' in e ? e.values : e);
  switch (e.kind) {
    case 'device.telemetry':
      return {
        time,
        tone: 'neutral',
        kind,
        subject: e.deviceCode,
        summary: summarizeValues(e.values, t, 'en'),
        raw,
      };
    case 'device.activity':
      return {
        time,
        tone: e.online ? 'online' : 'off',
        kind,
        subject: e.deviceCode,
        summary: e.online ? t('events.online') : t('events.offline'),
        raw,
      };
    case 'device.attributes':
      return {
        time,
        tone: 'accent',
        kind,
        subject: e.deviceCode,
        summary: Object.keys(e.attributes).join(', '),
        raw,
      };
    case 'alarm':
      return {
        time,
        tone: e.status === 'cleared' ? 'online' : 'alarm',
        kind,
        subject: e.deviceCode,
        summary: `${e.alarmType} · ${e.severity} · ${e.status}`,
        raw,
      };
    case 'room.presence':
      return {
        time,
        tone: e.occupied ? 'online' : 'off',
        kind,
        subject: e.room,
        summary: t('telemetry.people', { count: e.occupied ? e.count : 0 }),
        raw,
      };
    case 'automation.run':
      return { time, tone: 'accent', kind, subject: e.automationKey, summary: e.status, raw };
    case 'notification':
      return { time, tone: 'accent', kind, subject: e.title, summary: e.body ?? '', raw };
    case 'clock':
      return {
        time,
        tone: 'accent',
        kind,
        subject: e.timeZone,
        summary: `${new Date(e.virtualNow).toLocaleString('en-GB', { timeZone: e.timeZone })} · ${
          e.state.speed
        }×`,
        raw,
      };
  }
}

const LINE_TONE: Record<EventLine['tone'], string> = {
  neutral: 'bg-gray-300',
  online: 'bg-emerald-500',
  off: 'bg-gray-400',
  alarm: 'bg-red-500',
  accent: 'bg-blue-500',
};

function EventLineView({ line }: { line: EventLine }) {
  return (
    <li className="flex items-baseline gap-2 whitespace-nowrap" title={line.raw}>
      <span className="text-muted-foreground tabular-nums">{line.time}</span>
      <span
        className={cn(
          'inline-block size-2 shrink-0 translate-y-[-1px] rounded-full',
          LINE_TONE[line.tone],
        )}
        aria-hidden
      />
      <span className="text-muted-foreground">{line.kind}</span>
      <span className="font-semibold">{line.subject}</span>
      <span>{line.summary}</span>
    </li>
  );
}
