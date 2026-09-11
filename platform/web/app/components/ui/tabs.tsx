import * as React from 'react';
import { cn } from '~/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: React.ReactNode;
  disabled?: boolean;
}

/** Accessible tab strip; content is rendered by the caller from `value`. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex flex-wrap gap-1 border-b', className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onChange(item.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
