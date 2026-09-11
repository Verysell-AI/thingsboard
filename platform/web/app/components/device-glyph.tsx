import type { LucideIcon } from 'lucide-react';
import { DOT_COLOURS, ICON_COLOUR, type Dot } from '~/lib/device-icons';
import { cn } from '~/lib/utils';

/** Device icon with a status dot on its top corner; the HTML twin of the plan marker. */
export function DeviceGlyph({
  icon: Icon,
  dot,
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  dot: Dot | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'size-10' : size === 'sm' ? 'size-7' : 'size-8';
  const glyph = size === 'lg' ? 'size-5' : size === 'sm' ? 'size-4' : 'size-4';
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border bg-white',
        box,
        className,
      )}
      style={{ color: ICON_COLOUR }}
    >
      <Icon className={glyph} aria-hidden />
      {dot && (
        <span
          data-dot={dot}
          className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white"
          style={{ background: DOT_COLOURS[dot] }}
          aria-hidden
        />
      )}
    </span>
  );
}
