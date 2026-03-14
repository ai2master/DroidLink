export function safeJsonParse(val: unknown): any {
  if (!val) return null;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return null; }
}

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export function formatFileSize(bytes: number): string {
  if (!bytes || !isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(date: string | number): string {
  if (!date) return '';
  const d = typeof date === 'number' ? dayjs(date) : dayjs(date);
  if (!d.isValid()) return String(date);
  const now = dayjs();
  if (now.diff(d, 'day') < 1) return d.format('HH:mm');
  if (now.diff(d, 'day') < 7) return d.format('ddd HH:mm');
  if (now.year() === d.year()) return d.format('MM-DD HH:mm');
  return d.format('YYYY-MM-DD HH:mm');
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}时${m}分`;
}

export function formatRelativeTime(date: string): string {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  return d.fromNow();
}

export function callTypeText(type: number): string {
  switch (type) {
    case 1: return '来电';
    case 2: return '去电';
    case 3: return '未接';
    case 4: return '语音邮件';
    case 5: return '拒接';
    default: return '其他';
  }
}

export function callTypeColor(type: number): string {
  switch (type) {
    case 1: return '#52c41a';
    case 2: return '#1677ff';
    case 3: return '#ff4d4f';
    case 5: return '#faad14';
    default: return '#8c8c8c';
  }
}

export function msgTypeText(type: number): string {
  return type === 2 ? '已发送' : '已接收';
}
