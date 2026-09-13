import {
  Bell,
  Boxes,
  CalendarDays,
  DoorOpen,
  FileText,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
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
 * Navigation sidebar. Static on md+ screens, where `collapsed` shrinks it to an icon rail (labels
 * stay in the DOM for screen readers and show as tooltips); below that it is an overlay drawer
 * controlled by `open` (the header's menu button) and closes on navigation or backdrop click.
 */
export function Sidebar({
  showConsole,
  role,
  open,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: {
  showConsole: boolean;
  role?: Role;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { t } = useTranslation();
  const branding = useBranding();
  const logo = brandAssetUrl(branding.logoUrl);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
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
        data-collapsed={collapsed || undefined}
        className={cn(
          'z-40 w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground',
          'fixed inset-y-0 start-0 md:static md:flex md:transition-[width] md:duration-200',
          collapsed && 'md:w-14',
          open ? 'flex' : 'hidden',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center justify-between border-b px-4',
            collapsed && 'md:justify-center md:px-0',
          )}
        >
          {logo ? (
            <img
              src={logo}
              alt={branding.name}
              className={cn('h-8 max-w-full object-contain', collapsed && 'md:hidden')}
            />
          ) : (
            <span className={cn('truncate font-semibold text-primary', collapsed && 'md:hidden')}>
              {branding.name}
            </span>
          )}
          {onToggleCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 text-muted-foreground md:inline-flex"
              aria-label={collapsed ? t('app.expandMenu') : t('app.collapseMenu')}
              aria-expanded={!collapsed}
              title={collapsed ? t('app.expandMenu') : t('app.collapseMenu')}
              onClick={onToggleCollapsed}
            >
              <ToggleIcon className="rtl:-scale-x-100" aria-hidden />
            </Button>
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
        <nav
          className={cn('flex flex-1 flex-col gap-1 p-3', collapsed && 'md:p-2')}
          aria-label="Main"
          onClick={onClose}
        >
          {role !== 'FINANCE' && (
            <>
              <NavLink collapsed={collapsed} to="/floors/1" icon={Map} label={t('nav.floorPlan')} />
              <NavLink collapsed={collapsed} to="/assets" icon={Boxes} label={t('nav.assets')} />
              <NavLink collapsed={collapsed} to="/employees" icon={Users} label={t('nav.people')} />
              <NavLink collapsed={collapsed} to="/rooms" icon={DoorOpen} label={t('nav.rooms')} />
              <NavLink collapsed={collapsed} to="/energy" icon={Zap} label={t('nav.energy')} />
              <NavLink
                collapsed={collapsed}
                to="/automations"
                icon={Workflow}
                label={t('nav.automations')}
              />
              <NavLink
                collapsed={collapsed}
                to="/maintenance"
                icon={Wrench}
                label={t('nav.maintenance')}
              />
              <NavLink
                collapsed={collapsed}
                to="/calendar"
                icon={CalendarDays}
                label={t('nav.calendar')}
              />
            </>
          )}
          {role !== 'FIELD_OPERATOR' && role !== 'VIEWER' && (
            <NavLink
              collapsed={collapsed}
              to={role === 'FINANCE' ? '/reports/energy-cost' : '/reports/mornings'}
              icon={FileText}
              label={t('nav.reports')}
            />
          )}
          <NavLink
            collapsed={collapsed}
            to="/notifications"
            icon={Bell}
            label={t('nav.notifications')}
          />
          <NavLink collapsed={collapsed} to="/audit" icon={ScrollText} label={t('nav.audit')} />
          {showConsole && (
            <NavLink
              collapsed={collapsed}
              to="/console"
              icon={TerminalSquare}
              label={t('nav.console')}
            />
          )}
        </nav>
      </aside>
    </>
  );
}
