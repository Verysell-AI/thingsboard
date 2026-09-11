import type { LucideIcon } from 'lucide-react';
import { NavLink as RouterNavLink } from 'react-router';
import { cn } from '~/lib/utils';

export function NavLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <RouterNavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </RouterNavLink>
  );
}
