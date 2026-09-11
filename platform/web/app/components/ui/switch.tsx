import * as React from 'react';
import { cn } from '~/lib/utils';

/** On/off toggle. `title` doubles as the tooltip explaining why it is disabled. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/40',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
