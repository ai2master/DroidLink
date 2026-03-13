import * as React from 'react';
import { cn } from '../../utils/cn';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

function Slider({ value, onChange, min = 0, max = 100, step = 1, disabled, className }: SliderProps) {
  return (
    <input
      type="range"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        'w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer',
        'accent-primary',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    />
  );
}

export { Slider };
