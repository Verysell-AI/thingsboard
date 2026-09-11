import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '~/lib/utils';

/** Native select styled like the shadcn trigger; enough for the console without extra dependencies. */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-input bg-transparent ps-3 pe-8 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
