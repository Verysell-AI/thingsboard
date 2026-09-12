import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { ROLES, type Role } from '@platform/shared';
import { LOCALES, type Locale } from '@platform/shared/dataset';
import type { AdminTenant, UpdateTenantRequest } from '@platform/shared/dto';
import {
  BrandFields,
  DEFAULT_BRAND_DRAFT,
  brandDraftToInput,
  type BrandDraft,
} from '~/components/admin/brand-fields';
import { JobProgress } from '~/components/admin/job-progress';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { Tabs } from '~/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  adminKeys,
  createTenantUser,
  deleteTenant,
  deleteTenantUser,
  loadTenantDataset,
  updateTenant,
  updateTenantUser,
  useAdminTenant,
  useAdminUsers,
  useDatasets,
} from '~/lib/admin';
import { isApiError } from '~/lib/api';
import { formatDateTime } from '~/lib/format';

type TabKey = 'settings' | 'branding' | 'users' | 'danger';

export default function TenantDetailRoute() {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const tenant = useAdminTenant(key);
  const [tab, setTab] = useState<TabKey>('settings');

  // a stale error while a refetch is in flight (e.g. right after the key was reused) is not a verdict
  if (tenant.isPending || (tenant.isError && tenant.isFetching))
    return <p className="text-sm text-muted-foreground">{t('app.loading')}</p>;
  if (tenant.isError) {
    if (isApiError(tenant.error) && tenant.error.status === 404)
      return <Navigate to="/admin" replace />;
    return <p className="text-sm text-destructive">{t('app.error')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin" aria-label={t('admin.create.backToList')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{tenant.data.name}</h1>
        <Badge variant="outline" className="font-mono">
          {tenant.data.key}
        </Badge>
        {tenant.data.demoMode && <Badge variant="accent">{t('admin.tenants.demo')}</Badge>}
        <Button variant="outline" size="sm" className="ms-auto" asChild>
          <a href={tenant.data.url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            {t('admin.tenants.open')}
          </a>
        </Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'settings', label: t('admin.section.identity') },
          { key: 'branding', label: t('admin.section.branding') },
          { key: 'users', label: t('admin.section.users') },
          { key: 'danger', label: t('admin.section.danger') },
        ]}
      />

      {tab === 'settings' && <SettingsTab tenant={tenant.data} />}
      {tab === 'branding' && <BrandingTab tenant={tenant.data} />}
      {tab === 'users' && <UsersTab tenantKey={tenant.data.key} />}
      {tab === 'danger' && <DangerTab tenant={tenant.data} />}
    </div>
  );
}

/** Shared save mutation for the settings and branding forms. */
function useSaveTenant(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTenantRequest) => updateTenant(key, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminKeys.tenant(key), updated);
      void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
    },
  });
}

function SaveRow({ pending, saved, error }: { pending: boolean; saved: boolean; error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? t('admin.save.saving') : t('admin.save.save')}
      </Button>
      {saved && <span className="text-sm text-emerald-600">{t('admin.save.saved')}</span>}
      {error !== null && error !== undefined && (
        <span className="text-sm text-destructive">
          {isApiError(error) ? error.message : t('app.error')}
        </span>
      )}
    </div>
  );
}

function SettingsTab({ tenant }: { tenant: AdminTenant }) {
  const { t } = useTranslation();
  const save = useSaveTenant(tenant.key);
  const [name, setName] = useState(tenant.name);
  const [hostname, setHostname] = useState(tenant.hostname);
  const [locale, setLocale] = useState<Locale>(tenant.locale);
  const [currency, setCurrency] = useState(tenant.currency);
  const [tariff, setTariff] = useState(String(tenant.tariffPerKwh));
  const [demoMode, setDemoMode] = useState(tenant.demoMode);
  const [simulated, setSimulated] = useState(tenant.simulated);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({
      name: name.trim(),
      hostname: hostname.trim(),
      locale,
      currency: currency.trim().toUpperCase(),
      tariffPerKwh: Number(tariff),
      demoMode,
      simulated,
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t('admin.field.name')}</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hostname">{t('admin.field.hostname')}</Label>
              <Input
                id="hostname"
                required
                value={hostname}
                onChange={(e) => setHostname(e.target.value.toLowerCase())}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="locale">{t('admin.field.locale')}</Label>
                <Select
                  id="locale"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale)}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="currency">{t('admin.field.currency')}</Label>
                <Input
                  id="currency"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tariff">{t('admin.field.tariff')}</Label>
                <Input
                  id="tariff"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={tariff}
                  onChange={(e) => setTariff(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="demo-mode" checked={demoMode} onCheckedChange={setDemoMode} />
              <Label htmlFor="demo-mode">{t('admin.field.demoMode')}</Label>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <div className="flex items-center gap-3">
                <Switch id="simulated" checked={simulated} onCheckedChange={setSimulated} />
                <Label htmlFor="simulated">{t('admin.field.simulated')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t('admin.field.simulatedHint')}</p>
            </div>
          </div>
          <SaveRow pending={save.isPending} saved={save.isSuccess} error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}

function BrandingTab({ tenant }: { tenant: AdminTenant }) {
  const save = useSaveTenant(tenant.key);
  const [brand, setBrand] = useState<BrandDraft>({
    ...DEFAULT_BRAND_DRAFT,
    shortName: tenant.shortName,
    primaryColor: tenant.primaryColor,
    accentColor: tenant.accentColor,
    fontFamily: tenant.fontFamily,
    loginTagline: tenant.loginTagline ?? '',
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ brand: brandDraftToInput(brand) });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <BrandFields
            value={brand}
            onChange={setBrand}
            logoUrl={tenant.logoUrl}
            faviconUrl={tenant.faviconUrl}
          />
          <SaveRow pending={save.isPending} saved={save.isSuccess} error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}

function UsersTab({ tenantKey }: { tenantKey: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const users = useAdminUsers(tenantKey);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('OPS_MANAGER');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.users(tenantKey) });
    void queryClient.invalidateQueries({ queryKey: adminKeys.tenant(tenantKey) });
    void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
  };

  const create = useMutation({
    mutationFn: () =>
      createTenantUser(tenantKey, {
        email: email.trim(),
        password,
        role,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    onSuccess: () => {
      setEmail('');
      setPassword('');
      setDisplayName('');
      invalidate();
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ id, next }: { id: string; next: Role }) =>
      updateTenantUser(tenantKey, id, { role: next }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTenantUser(tenantKey, id),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-4">
      {users.isPending ? (
        <p className="text-sm text-muted-foreground">{t('app.loading')}</p>
      ) : users.isError ? (
        <p className="text-sm text-destructive">{t('app.error')}</p>
      ) : users.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.users.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('login.email')}</TableHead>
              <TableHead>{t('admin.field.displayName')}</TableHead>
              <TableHead>{t('admin.users.role')}</TableHead>
              <TableHead>{t('admin.users.lastLogin')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.displayName}</TableCell>
                <TableCell>
                  <Select
                    aria-label={t('admin.users.role')}
                    className="w-44"
                    value={user.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate({ id: user.id, next: e.target.value as Role })
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(user.lastLoginAt, i18n.language, 'UTC')}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('admin.users.remove')}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(user.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardContent className="pt-6">
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-email">{t('login.email')}</Label>
              <Input
                id="user-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-password">{t('login.password')}</Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-name">{t('admin.field.displayName')}</Label>
              <Input
                id="user-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-role">{t('admin.users.role')}</Label>
              <Select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t('admin.users.adding') : t('admin.users.add')}
              </Button>
              {create.isError && (
                <span className="ms-3 text-sm text-destructive">
                  {isApiError(create.error) ? create.error.message : t('app.error')}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DangerTab({ tenant }: { tenant: AdminTenant }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const datasets = useDatasets();
  const [dataset, setDataset] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useMutation({
    mutationFn: () => loadTenantDataset(tenant.key, dataset),
    onSuccess: (job) => {
      setDeleting(false);
      setJobId(job.id);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTenant(tenant.key),
    onSuccess: (job) => {
      setDeleting(true);
      setJobId(job.id);
    },
  });

  if (jobId) {
    return (
      <JobProgress
        jobId={jobId}
        onDone={(job) => {
          void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
          if (job.status !== 'succeeded') return;
          if (deleting) {
            // drop the deleted tenant's entries; a cached 404 would bounce a later tenant
            // created under the same key straight back to the list
            queryClient.removeQueries({ queryKey: adminKeys.tenant(tenant.key) });
            queryClient.removeQueries({ queryKey: adminKeys.users(tenant.key) });
            navigate('/admin', { replace: true });
          } else {
            void queryClient.invalidateQueries({ queryKey: adminKeys.tenant(tenant.key) });
            void queryClient.invalidateQueries({ queryKey: adminKeys.users(tenant.key) });
            setJobId(null);
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div>
            <h2 className="font-semibold">{t('admin.section.dataset')}</h2>
            <p className="text-sm text-muted-foreground">{t('admin.danger.datasetHelp')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2 sm:w-64">
              <Label htmlFor="dataset">{t('admin.field.dataset')}</Label>
              <Select id="dataset" value={dataset} onChange={(e) => setDataset(e.target.value)}>
                <option value="">{t('admin.field.datasetNone')}</option>
                {(datasets.data ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={!dataset || load.isPending} onClick={() => load.mutate()}>
              {load.isPending ? t('admin.danger.loading') : t('admin.danger.loadDataset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div>
            <h2 className="font-semibold text-destructive">{t('admin.danger.deleteTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('admin.danger.deleteHelp', { key: tenant.key })}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2 sm:w-64">
              <Label htmlFor="confirm-key">{t('admin.danger.confirmLabel')}</Label>
              <Input
                id="confirm-key"
                value={confirmKey}
                placeholder={tenant.key}
                onChange={(e) => setConfirmKey(e.target.value)}
              />
            </div>
            <Button
              variant="destructive"
              disabled={confirmKey !== tenant.key || remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" />
              {t('admin.danger.delete')}
            </Button>
          </div>
          {remove.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {isApiError(remove.error) ? remove.error.message : t('app.error')}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
