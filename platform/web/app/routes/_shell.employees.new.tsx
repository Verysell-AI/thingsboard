import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, PlayCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { DEPARTMENTS, PERSONA_KEYS } from '@platform/shared/dataset';
import {
  CreateEmployeeResponseSchema,
  LocationsResponseSchema,
  ScenarioResultSchema,
  type CreateEmployee,
  type CreateEmployeeResponse,
  type MeResponse,
} from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { DeviceGlyph } from '~/components/device-glyph';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { api, isApiError } from '~/lib/api';
import { deviceDot, deviceIcon, deviceStatus } from '~/lib/device-icons';
import { formatAgo } from '~/lib/format';
import { useLive } from '~/lib/live';

export default function NewEmployeeRoute() {
  const { t } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [department, setDepartment] = useState<CreateEmployee['department']>('Engineering');
  const [deskRoomId, setDeskRoomId] = useState('');
  const [deskCode, setDeskCode] = useState('');
  const [persona, setPersona] = useState<string>('standard');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<CreateEmployeeResponse | null>(null);

  const rooms = useQuery({
    queryKey: ['locations', 'ROOM'],
    queryFn: () => api.get('/locations?type=ROOM', LocationsResponseSchema),
    staleTime: 5 * 60_000,
  });
  const openPlan = (rooms.data?.items ?? []).filter((r) => r.kind === 'open_plan');
  if (!deskRoomId && openPlan[0]) setDeskRoomId(openPlan[0].id);

  const create = useMutation({
    mutationFn: (body: CreateEmployee) =>
      api.post('/employees', body, CreateEmployeeResponseSchema),
    onSuccess: (res) => {
      setCreated(res);
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body: CreateEmployee = {
      name: name.trim(),
      department,
      deskRoomId,
      ...(deskCode.trim() ? { deskCode: deskCode.trim() } : {}),
      ...(me.tenant.demoMode ? { persona: persona as CreateEmployee['persona'] } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    create.mutate(body);
  };

  if (created) return <CreatedView result={created} me={me} onAnother={() => setCreated(null)} />;

  return (
    <div className="flex flex-col gap-4" data-testid="new-employee">
      <div>
        <h1 className="text-xl font-semibold">{t('employees.new')}</h1>
        <p className="text-sm text-muted-foreground">{t('employees.newHelp')}</p>
      </div>
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-name">{t('employees.columns.name')}</Label>
              <Input
                id="emp-name"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-dept">{t('employees.columns.department')}</Label>
                <Select
                  id="emp-dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as CreateEmployee['department'])}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {t(`departments.${d}`, { defaultValue: d })}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-room">{t('employees.deskRoom')}</Label>
                <Select
                  id="emp-room"
                  required
                  value={deskRoomId}
                  onChange={(e) => setDeskRoomId(e.target.value)}
                >
                  {openPlan.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-desk">{t('employees.deskCode')}</Label>
                <Input
                  id="emp-desk"
                  placeholder={t('employees.deskCodeHelp')}
                  value={deskCode}
                  onChange={(e) => setDeskCode(e.target.value)}
                  dir="ltr"
                />
              </div>
              {me.tenant.demoMode && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="emp-persona">{t('employees.columns.persona')}</Label>
                  <Select
                    id="emp-persona"
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                  >
                    {PERSONA_KEYS.map((p) => (
                      <option key={p} value={p}>
                        {t(`personas.${p}`, { defaultValue: p })}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="emp-email">{t('employees.email')}</Label>
                <Input
                  id="emp-email"
                  type="email"
                  placeholder={t('employees.emailHelp')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>
            {create.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {isApiError(create.error)
                    ? (create.error.detail ?? create.error.title)
                    : String(create.error)}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline">
                <Link to="/employees">{t('employees.cancel')}</Link>
              </Button>
              <Button type="submit" disabled={create.isPending || !deskRoomId}>
                {create.isPending ? t('app.loading') : t('employees.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CreatedView({
  result,
  me,
  onAnother,
}: {
  result: CreateEmployeeResponse;
  me: MeResponse;
  onAnother: () => void;
}) {
  const { t, i18n } = useTranslation();
  const live = useLive().devices[result.asset.code];
  const device = { type: 'laptop', code: result.asset.code };
  const status = deviceStatus(device, live);
  const firstBoot = useMutation({
    mutationFn: () =>
      api.post(
        `/console/scenario/new-laptop-first-boot`,
        { code: result.asset.code },
        ScenarioResultSchema,
      ),
  });
  const canBoot = me.tenant.demoMode && result.simulated && me.user.role === 'TENANT_ADMIN';

  return (
    <div className="flex flex-col gap-4" data-testid="employee-created">
      <Alert variant="success">
        <AlertTitle>{t('employees.createdTitle', { name: result.employee.name })}</AlertTitle>
        <AlertDescription>{t('employees.createdBody')}</AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{result.employee.name}</CardTitle>
            <CardDescription dir="ltr">{result.employee.email}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <span>
              {t('employees.columns.code')}: <span dir="ltr">{result.employee.code}</span>
            </span>
            <span>
              {t('employees.columns.department')}:{' '}
              {t(`departments.${result.employee.department}`, {
                defaultValue: result.employee.department,
              })}
            </span>
            <span>
              {t('employees.columns.desk')}: {result.employee.deskRoom?.name ?? '—'}
              {result.employee.deskCode ? ` · ${result.employee.deskCode}` : ''}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Laptop className="size-4" aria-hidden /> {t('employees.laptopTitle')}
            </CardTitle>
            <CardDescription dir="ltr">{result.asset.code}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-3">
              <DeviceGlyph icon={deviceIcon(device)} dot={deviceDot(device, live)} />
              <Badge
                variant={
                  status === 'alarm' ? 'destructive' : status === 'online' ? 'success' : 'secondary'
                }
                data-testid="laptop-status"
              >
                {t(`status.${status}`)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t('floor.lastUpdate', { ago: formatAgo(live?.ts, t, i18n.language) })}
              </span>
            </div>
            {live?.activeAlarms.length ? (
              <ul className="text-destructive">
                {live.activeAlarms.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={assetDrawerLink(result.asset.id)}>{t('employees.openAsset')}</Link>
              </Button>
              {canBoot && (
                <Button
                  size="sm"
                  disabled={firstBoot.isPending}
                  onClick={() => firstBoot.mutate()}
                  data-testid="first-boot"
                >
                  <PlayCircle aria-hidden /> {t('console.firstBoot')}
                </Button>
              )}
            </div>
            {firstBoot.data && (
              <p className="text-xs text-muted-foreground">{firstBoot.data.message}</p>
            )}
            {firstBoot.isError && (
              <p className="text-xs text-destructive">
                {isApiError(firstBoot.error)
                  ? (firstBoot.error.detail ?? firstBoot.error.title)
                  : String(firstBoot.error)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onAnother}>
          {t('employees.addAnother')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/employees">{t('employees.backToList')}</Link>
        </Button>
      </div>
    </div>
  );
}
