import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { LOCALES, type Locale } from '@platform/shared/dataset';
import { TENANT_KEY_RE, type CreateTenantRequest } from '@platform/shared/dto';
import {
  BrandFields,
  DEFAULT_BRAND_DRAFT,
  brandDraftToInput,
  type BrandDraft,
} from '~/components/admin/brand-fields';
import { JobProgress } from '~/components/admin/job-progress';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { adminKeys, createTenant, useDatasets, usePlatformInfo } from '~/lib/admin';
import { isApiError } from '~/lib/api';

export default function NewTenantRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const datasets = useDatasets();
  // the API defaults a blank hostname to <key>.<platform host>; the placeholder shows the same
  const platformHost = usePlatformInfo().data?.host ?? 'localhost';

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const [currency, setCurrency] = useState('AED');
  const [tariff, setTariff] = useState('0.44');
  const [demoMode, setDemoMode] = useState(false);
  const [simulated, setSimulated] = useState(true);
  const [dataset, setDataset] = useState('');
  const [brand, setBrand] = useState<BrandDraft>(DEFAULT_BRAND_DRAFT);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const keyValid = TENANT_KEY_RE.test(key);
  const create = useMutation({
    mutationFn: (body: CreateTenantRequest) => createTenant(body),
    onSuccess: (job) => setJobId(job.id),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const brandInput = brandDraftToInput(brand, name.trim());
    create.mutate({
      key,
      name: name.trim(),
      hostname: hostname.trim() || undefined,
      locale,
      currency: currency.trim().toUpperCase(),
      tariffPerKwh: Number(tariff),
      demoMode,
      simulated,
      ...(dataset ? { dataset } : {}),
      ...(brandInput ? { brand: brandInput } : {}),
      ...(adminEmail.trim()
        ? {
            admin: {
              email: adminEmail.trim(),
              password: adminPassword,
              ...(adminName.trim() ? { displayName: adminName.trim() } : {}),
            },
          }
        : {}),
    });
  }

  if (jobId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t('admin.create.provisioning', { name })}</h1>
        <JobProgress
          jobId={jobId}
          onDone={(job) => {
            if (job.status !== 'succeeded') return;
            void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
            navigate(`/admin/tenants/${key}`, { replace: true });
          }}
        />
        <Button variant="outline" className="self-start" asChild>
          <Link to="/admin">{t('admin.create.backToList')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin" aria-label={t('admin.create.backToList')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t('admin.create.title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.section.identity')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="key">{t('admin.field.key')}</Label>
            <Input
              id="key"
              required
              value={key}
              placeholder="gamma"
              onChange={(e) => setKey(e.target.value.toLowerCase())}
            />
            <p className="text-xs text-muted-foreground">{t('admin.field.keyHint')}</p>
            {key && !keyValid && (
              <p className="text-xs text-destructive">{t('admin.field.keyInvalid')}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t('admin.field.name')}</Label>
            <Input
              id="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hostname">{t('admin.field.hostname')}</Label>
            <Input
              id="hostname"
              value={hostname}
              placeholder={key ? `${key}.${platformHost}` : `gamma.${platformHost}`}
              onChange={(e) => setHostname(e.target.value.toLowerCase())}
            />
            <p className="text-xs text-muted-foreground">{t('admin.field.hostnameHint')}</p>
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
                value={currency}
                maxLength={3}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.section.branding')}</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandFields value={brand} onChange={setBrand} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.section.firstUser')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-email">{t('login.email')}</Label>
            <Input
              id="admin-user-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-password">{t('login.password')}</Label>
            <Input
              id="admin-user-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required={adminEmail.trim().length > 0}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-name">{t('admin.field.displayName')}</Label>
            <Input
              id="admin-user-name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            {t('admin.section.firstUserHint')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.section.dataset')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:max-w-xs">
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
          <div className="flex items-center gap-3">
            <Switch checked={demoMode} onCheckedChange={setDemoMode} id="demo-mode" />
            <Label htmlFor="demo-mode">{t('admin.field.demoMode')}</Label>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Switch checked={simulated} onCheckedChange={setSimulated} id="simulated" />
              <Label htmlFor="simulated">{t('admin.field.simulated')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('admin.field.simulatedHint')}</p>
          </div>
        </CardContent>
      </Card>

      {create.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(create.error) ? create.error.message : t('app.error')}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !keyValid}>
          {create.isPending ? t('admin.create.submitting') : t('admin.create.submit')}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to="/admin">{t('admin.create.cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
