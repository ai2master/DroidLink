import { describe, it, expect } from 'vitest';
import {
  safeJsonParse,
  formatFileSize,
  formatDuration,
  callTypeText,
  callTypeColor,
  msgTypeText,
} from './format';

describe('safeJsonParse', () => {
  it('returns null for falsy values', () => {
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse(0)).toBeNull();
  });

  it('returns non-string values as-is', () => {
    const obj = { a: 1 };
    expect(safeJsonParse(obj)).toBe(obj);
    expect(safeJsonParse(42)).toBe(42);
    expect(safeJsonParse(true)).toBe(true);
  });

  it('parses valid JSON strings', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"')).toBe('hello');
  });

  it('returns null for invalid JSON strings', () => {
    expect(safeJsonParse('{invalid}')).toBeNull();
    expect(safeJsonParse('not json')).toBeNull();
  });
});

describe('formatFileSize', () => {
  it('returns "0 B" for zero or invalid bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(-1)).toBe('0 B');
    expect(formatFileSize(NaN)).toBe('0 B');
    expect(formatFileSize(Infinity)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
    expect(formatFileSize(1099511627776)).toBe('1.0 TB');
  });

  it('handles large values above TB', () => {
    // Values beyond TB should still show TB
    const petabyte = 1099511627776 * 1024;
    expect(formatFileSize(petabyte)).toBe('1024.0 TB');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(30)).toBe('30秒');
    expect(formatDuration(0)).toBe('0秒');
    expect(formatDuration(59)).toBe('59秒');
  });

  it('formats minutes', () => {
    expect(formatDuration(60)).toBe('1分0秒');
    expect(formatDuration(90)).toBe('1分30秒');
    expect(formatDuration(3599)).toBe('59分59秒');
  });

  it('formats hours', () => {
    expect(formatDuration(3600)).toBe('1时0分');
    expect(formatDuration(7260)).toBe('2时1分');
  });
});

describe('callTypeText', () => {
  it('returns correct text for known types', () => {
    expect(callTypeText(1)).toBe('来电');
    expect(callTypeText(2)).toBe('去电');
    expect(callTypeText(3)).toBe('未接');
    expect(callTypeText(4)).toBe('语音邮件');
    expect(callTypeText(5)).toBe('拒接');
  });

  it('returns "其他" for unknown types', () => {
    expect(callTypeText(0)).toBe('其他');
    expect(callTypeText(99)).toBe('其他');
  });
});

describe('callTypeColor', () => {
  it('returns correct color for known types', () => {
    expect(callTypeColor(1)).toBe('#52c41a');
    expect(callTypeColor(2)).toBe('#059669');
    expect(callTypeColor(3)).toBe('#ff4d4f');
    expect(callTypeColor(5)).toBe('#faad14');
  });

  it('returns default gray for unknown types', () => {
    expect(callTypeColor(0)).toBe('#8c8c8c');
    expect(callTypeColor(99)).toBe('#8c8c8c');
  });
});

describe('msgTypeText', () => {
  it('returns correct text for message types', () => {
    expect(msgTypeText(2)).toBe('已发送');
    expect(msgTypeText(1)).toBe('已接收');
    expect(msgTypeText(0)).toBe('已接收');
  });
});
