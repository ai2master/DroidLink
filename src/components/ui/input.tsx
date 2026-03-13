import * as React from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  suffix?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, suffix, ...props }, ref) => {
    const renderIcon = () => {
      if (!icon) return null;
      if (typeof icon === 'function') {
        const IconComp = icon as React.ComponentType<{ className?: string }>;
        return <IconComp className="h-4 w-4" />;
      }
      return icon;
    };
    if (icon || suffix) {
      return (
        <div className="relative flex items-center">
          {icon && <span className="absolute left-2.5 text-gray-400 pointer-events-none">{renderIcon()}</span>}
          <input
            ref={ref}
            className={cn(
              'flex h-8 w-full rounded-[var(--border-radius)] border border-border bg-white',
              'text-[var(--font-size-base)] placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-primary/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
              icon ? 'pl-8 pr-3' : 'px-3',
              suffix ? 'pr-8' : '',
              className,
            )}
            {...props}
          />
          {suffix && <span className="absolute right-2.5 text-gray-400">{suffix}</span>}
        </div>
      );
    }
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-8 w-full rounded-[var(--border-radius)] border border-border bg-white px-3',
          'text-[var(--font-size-base)] placeholder:text-gray-400',
          'focus:outline-none focus:ring-2 focus:ring-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-[var(--border-radius)] border border-border bg-white px-3 py-2',
        'text-[var(--font-size-base)] placeholder:text-gray-400',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none',
        className,
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
