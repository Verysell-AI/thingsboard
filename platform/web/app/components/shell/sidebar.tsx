import {
  Bell,
  Boxes,
  CalendarDays,
  DoorOpen,
  FileText,
  Map,
  ScrollText,
  TerminalSquare,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Role } from '@platform/shared/roles';
import { brandAssetUrl, useBranding } from '~/lib/branding';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { NavLink } from './nav-link';

/**
 * Navigation sidebar. Static on md+ screens; below that it is an overlay drawer controlled by
 * `open` (the header's menu button) and closes on navigation or backdrop click.
 */
export function Sidebar({
  showConsole,
  role,
  open,
  onClose,
}: {
  showConsole: boolean;
  role?: Role;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const branding = useBranding();
  const logo = brandAssetUrl(branding.logoUrl);
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label={t('app.closeMenu')}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'z-40 w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground',
          'fixed inset-y-0 start-0 md:static md:flex',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          {logo ? (
            <img src={logo} alt={branding.name} className="h-8 max-w-full object-contain" />
          ) : (
            <span className="truncate font-semibold text-primary">{branding.name}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('app.closeMenu')}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main" onClick={onClose}>
          {role !== 'FINANCE' && (
            <>
              <NavLink to="/floors/1" icon={Map} label={t('nav.floorPlan')} />
              <NavLink to="/assets" icon={Boxes} label={t('nav.assets')} />
              <NavLink to="/employees" icon={Users} label={t('nav.people')} />
              <NavLink to="/rooms" icon={DoorOpen} label={t('nav.rooms')} />
              <NavLink to="/energy" icon={Zap} label={t('nav.energy')} />
              <NavLink to="/automations" icon={Workflow} label={t('nav.automations')} />
              <NavLink to="/maintenance" icon={Wrench} label={t('nav.maintenance')} />
              <NavLink to="/calendar" icon={CalendarDays} label={t('nav.calendar')} />
            </>
          )}
          {role !== 'FIELD_OPERATOR' && role !== 'VIEWER' && (
            <NavLink
              to={role === 'FINANCE' ? '/reports/energy-cost' : '/reports/mornings'}
              icon={FileText}
              label={t('nav.reports')}
            />
          )}
          <NavLink to="/notifications" icon={Bell} label={t('nav.notifications')} />
          <NavLink to="/audit" icon={ScrollText} label={t('nav.audit')} />
          {showConsole && <NavLink to="/console" icon={TerminalSquare} label={t('nav.console')} />}
        </nav>
      </aside>
    </>
  );
}
