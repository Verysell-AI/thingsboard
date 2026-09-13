import type { LucideIcon } from 'lucide-react';
import { NavLink as RouterNavLink } from 'react-router';
import { cn } from '~/lib/utils';

/** One sidebar entry. When `collapsed`, md+ screens show only the icon; the label stays for AT. */
export function NavLink({
  to,
  icon: Icon,
  label,
  collapsed = false,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed?: boolean;
}) {
  return (
    <RouterNavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          collapsed && 'md:justify-center md:px-0',
          isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={cn(collapsed && 'md:sr-only')}>{label}</span>
    </RouterNavLink>
  );
}
