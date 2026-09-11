import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { Building2 } from 'lucide-react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { adminLogin } from '~/lib/admin';
import { adminSession } from '~/lib/auth';

export default function AdminLoginRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (adminSession.isAuthenticated()) return <Navigate to="/admin" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      await adminLogin(email, password);
      navigate('/admin', { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Building2 className="mb-2 size-8 text-primary" />
          <CardTitle>{t('admin.login.title')}</CardTitle>
          <CardDescription>{t('admin.login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-email">{t('login.email')}</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-password">{t('login.password')}</Label>
              <Input
                id="admin-password"
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
