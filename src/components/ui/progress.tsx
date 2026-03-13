import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../utils/cn';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorClassName, ...props }, ref) => (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-gray-100', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full bg-primary transition-all', indicatorClassName)}
        style={{ width: `${value || 0}%` }}
      />
    </ProgressPrimitive.Root>
  ),
);
Progress.displayName = 'Progress';

export { Progress };
