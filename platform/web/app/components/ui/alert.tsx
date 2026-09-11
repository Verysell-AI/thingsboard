import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '~/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      info: 'border-sky-200 bg-sky-50 text-sky-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      destructive: 'border-red-200 bg-red-50 text-red-900',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-1 font-medium', className)} {...props} />;
}
export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm opacity-90', className)} {...props} />;
}
