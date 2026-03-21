import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn (class name merger)', () => {
  it('merges simple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'end')).toBe('base end');
    expect(cn('base', true && 'visible', 'end')).toBe('base visible end');
  });

  it('deduplicates tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles empty and undefined inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
    expect(cn(undefined, null, false, '')).toBe('');
  });

  it('handles arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });
});
