import { Languages, LogOut, Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { MeResponse } from '@platform/shared/dto';
import { ClockBadge } from '~/components/clock-badge';
import { NotificationBell } from '~/components/notification-bell';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Select } from '~/components/ui/select';
import { clearTokens } from '~/lib/auth';
import { cn } from '~/lib/utils';
import { useBranding } from '~/lib/branding';
import { SUPPORTED_LOCALES, changeLocale, isLocale } from '~/lib/i18n';

export function Header({
  me,
  onMenu,
  navOpen = false,
}: {
  me: MeResponse;
  onMenu: () => void;
  navOpen?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const branding = useBranding();
  const navigate = useNavigate();

  function logout() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b bg-card px-4 sm:gap-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        aria-label={t('app.menu')}
        onClick={onMenu}
      >
        <Menu aria-hidden />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{branding.name}</div>
        {me.tenant.name !== branding.name && (
          <div className="truncate text-xs text-muted-foreground">{me.tenant.name}</div>
        )}
      </div>
      <div
        className={cn(
          'flex shrink-0 items-center gap-1 sm:gap-3',
          // the phone drawer covers the header; keep its controls out of the way while it is open
          navOpen && 'invisible md:visible',
        )}
      >
        <ClockBadge me={me} />
        <NotificationBell me={me} />
        <div className="hidden items-center gap-2 text-sm lg:flex">
          <span className="text-muted-foreground">{me.user.email}</span>
          <Badge variant="secondary">{t(`roles.${me.user.role}`)}</Badge>
        </div>
        <div className="hidden items-center gap-1 sm:flex" title={t('app.language')}>
          <Languages className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
          <Select
            aria-label={t('app.language')}
            value={i18n.language}
            onChange={(e) => {
              const v = e.target.value;
              if (isLocale(v)) void changeLocale(v);
            }}
            className="h-8 w-20"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} aria-label={t('app.logout')}>
          <LogOut aria-hidden />
          <span className="hidden sm:inline">{t('app.logout')}</span>
        </Button>
      </div>
    </header>
  );
}
