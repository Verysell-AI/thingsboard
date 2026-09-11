import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { TokenPairSchema } from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { api, tenantKeyOverride } from '~/lib/api';
import { isAuthenticated, setTokens } from '~/lib/auth';
import { brandAssetUrl, useBranding } from '~/lib/branding';

export default function LoginRoute() {
  const { t } = useTranslation();
  const branding = useBranding();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // only same-app paths are honoured, so a crafted link cannot bounce to another site
  const nextRaw = search.get('next');
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';
  tenantKeyOverride(search.toString() ? `?${search.toString()}` : '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (isAuthenticated()) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      const tokens = await api.post('/auth/login', { email, password }, TokenPairSchema, {
        auth: false,
      });
      setTokens(tokens);
      navigate(next, { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const logo = brandAssetUrl(branding.logoUrl);

  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        background: `linear-gradient(135deg, ${branding.primaryColor} 0%, ${branding.accentColor} 100%)`,
      }}
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          {logo ? (
            <img src={logo} alt={branding.name} className="mb-2 h-10 max-w-full object-contain" />
          ) : (
            <div className="mb-2 text-lg font-semibold text-primary">{branding.name}</div>
          )}
          <CardTitle>{t('login.title')}</CardTitle>
          {branding.loginTagline && <CardDescription>{branding.loginTagline}</CardDescription>}
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {failed && (
              <Alert variant="destructive">
                <AlertDescription>{t('login.failed')}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
