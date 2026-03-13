import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'destructive' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  loading?: boolean;
  asChild?: boolean;
  block?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', loading, asChild, block, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-[var(--border-radius)] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-white border border-border text-gray-700 hover:bg-gray-50 hover:text-gray-900': variant === 'default',
            'bg-primary text-white hover:bg-primary-hover': variant === 'primary',
            'bg-error text-white hover:bg-red-600': variant === 'destructive',
            'border border-border bg-transparent hover:bg-gray-50': variant === 'outline',
            'hover:bg-gray-100': variant === 'ghost',
            'text-primary underline-offset-4 hover:underline p-0 h-auto': variant === 'link',
          },
          {
            'h-8 px-3 text-[var(--font-size-base)]': size === 'default',
            'h-7 px-2 text-[var(--font-size-sm)]': size === 'sm',
            'h-10 px-4 text-[var(--font-size-lg)]': size === 'lg',
            'h-8 w-8 p-0': size === 'icon',
          },
          block && 'w-full',
          className,
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button };
