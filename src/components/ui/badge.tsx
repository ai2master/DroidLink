import * as React from 'react';
import { cn } from '../../utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'outline';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[var(--font-size-xs)] font-medium',
        {
          'bg-gray-100 text-gray-700': variant === 'default',
          'bg-green-50 text-green-700': variant === 'success',
          'bg-red-50 text-red-700': variant === 'error',
          'bg-yellow-50 text-yellow-700': variant === 'warning',
          'bg-emerald-50 text-emerald-700': variant === 'info',
          'border border-border text-gray-700': variant === 'outline',
        },
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
