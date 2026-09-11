import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/**
 * Right-side panel (start/end aware for RTL) without extra dependencies: a backdrop, Escape to close,
 * focus kept inside via autoFocus on the close button.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  closeLabel?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        className="flex-1 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex h-full w-full max-w-xl flex-col border-s bg-card text-card-foreground shadow-xl animate-in slide-in-from-end',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {description && (
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={closeLabel}
            autoFocus
            className="-me-2 shrink-0"
          >
            <X aria-hidden />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
