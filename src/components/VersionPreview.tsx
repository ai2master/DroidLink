import React from 'react';
import {
  Phone,
  Mail,
  User,
  Users,
  MessageSquare,
  Clock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDuration, callTypeColor } from '../utils/format';
import { cn } from '../utils/cn';

interface VersionPreviewProps {
  dataType: string;
  data: any;
  compact?: boolean;
}

/**
 * Rich preview component for version data - renders human-readable cards by data type
 */
export const VersionPreview: React.FC<VersionPreviewProps> = ({ dataType, data, compact = false }) => {
  const { t } = useTranslation();

  if (!data) {
    return <span className="text-gray-400">{t('versionHistory.noData')}</span>;
  }

  switch (dataType) {
    case 'contacts':
      return <ContactPreview data={data} compact={compact} />;
    case 'messages':
      return <MessagePreview data={data} compact={compact} />;
    case 'call_logs':
      return <CallLogPreview data={data} compact={compact} />;
    default:
      return (
        <pre className="bg-gray-50 p-3 rounded text-xs max-h-[200px] overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
};

const ContactPreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const phones = parseJsonArray(data.phoneNumbers);
  const emails = parseJsonArray(data.emails);

  if (compact) {
    return (
      <div className="space-y-1 w-full">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4" />
          <span className="font-semibold">{data.displayName || '-'}</span>
        </div>
        {phones.length > 0 && (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-green-600" />
            <span>{phones.join(', ')}</span>
          </div>
        )}
        {emails.length > 0 && (
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-emerald-600" />
            <span>{emails.join(', ')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-3 border border-border rounded-md text-[var(--font-size-sm)]">
      <dt className="font-medium text-gray-500 flex items-center gap-2">
        <User className="w-4 h-4" /> {t('contacts.name')}
      </dt>
      <dd className="text-gray-900">{data.displayName || '-'}</dd>

      <dt className="font-medium text-gray-500 flex items-center gap-2">
        <Phone className="w-4 h-4" /> {t('contacts.phone')}
      </dt>
      <dd className="text-gray-900">
        {phones.length > 0 ? phones.map((p: string, i: number) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 mr-1">
            {p}
          </span>
        )) : '-'}
      </dd>

      <dt className="font-medium text-gray-500 flex items-center gap-2">
        <Mail className="w-4 h-4" /> {t('contacts.email')}
      </dt>
      <dd className="text-gray-900">
        {emails.length > 0 ? emails.map((e: string, i: number) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 mr-1">
            {e}
          </span>
        )) : '-'}
      </dd>

      <dt className="font-medium text-gray-500 flex items-center gap-2">
        <Users className="w-4 h-4" /> {t('contacts.organization')}
      </dt>
      <dd className="text-gray-900">{data.organization || '-'}</dd>
    </dl>
  );
};

const MessagePreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const isSent = data.msgType === 2;

  if (compact) {
    return (
      <div className="space-y-1 w-full">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          <span className="font-semibold">{data.contactName || data.address || '-'}</span>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", isSent ? 'bg-emerald-50 text-emerald-700' : 'bg-green-50 text-green-700')}>
            {isSent ? t('messages.sent') : t('messages.received')}
          </span>
        </div>
        <p className="truncate max-w-[400px] text-gray-600">{data.body || '-'}</p>
      </div>
    );
  }

  return (
    <div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mb-2 p-3 border border-border rounded-md text-[var(--font-size-sm)]">
        <dt className="font-medium text-gray-500">{t('messages.contact')}</dt>
        <dd className="text-gray-900">{data.contactName || data.address || '-'}</dd>

        <dt className="font-medium text-gray-500">{t('messages.address')}</dt>
        <dd className="text-gray-900">{data.address || '-'}</dd>

        <dt className="font-medium text-gray-500">{t('messages.type')}</dt>
        <dd>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", isSent ? 'bg-emerald-50 text-emerald-700' : 'bg-green-50 text-green-700')}>
            {isSent ? t('messages.sent') : t('messages.received')}
          </span>
        </dd>

        <dt className="font-medium text-gray-500">{t('messages.date')}</dt>
        <dd className="text-gray-900">{data.date ? formatDate(data.date) : '-'}</dd>
      </dl>
      <div
        className={cn(
          "px-3 py-2 rounded-xl max-w-[80%] mt-2",
          isSent
            ? "bg-emerald-500 text-white ml-auto"
            : "bg-gray-100 text-gray-900 mr-auto"
        )}
      >
        <div className="break-words">{data.body || '-'}</div>
      </div>
    </div>
  );
};

const CallLogPreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const callType = data.callType ?? 0;
  const color = callTypeColor(callType);
  const typeLabel = callType === 1 ? t('callLogs.incoming')
    : callType === 2 ? t('callLogs.outgoing')
    : callType === 3 ? t('callLogs.missed')
    : t('callLogs.other');

  const getBadgeClass = () => {
    if (color === '#52c41a') return 'bg-green-50 text-green-700';
    if (color === '#059669') return 'bg-emerald-50 text-emerald-700';
    if (color === '#ff4d4f') return 'bg-red-50 text-red-700';
    return 'bg-gray-50 text-gray-700';
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Phone
          className="w-4 h-4"
          style={{ color, transform: callType === 1 ? 'rotate(135deg)' : callType === 2 ? 'rotate(-45deg)' : 'none' }}
        />
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", getBadgeClass())}>
          {typeLabel}
        </span>
        <span className="font-semibold">{data.contactName || data.number || '-'}</span>
        {data.duration > 0 && (
          <span className="text-gray-400 flex items-center gap-1">
            <Clock className="w-4 h-4" /> {formatDuration(data.duration)}
          </span>
        )}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-3 border border-border rounded-md text-[var(--font-size-sm)]">
      <dt className="font-medium text-gray-500">{t('callLogs.type')}</dt>
      <dd className="flex items-center gap-2">
        <Phone
          className="w-4 h-4"
          style={{ color, transform: callType === 1 ? 'rotate(135deg)' : callType === 2 ? 'rotate(-45deg)' : 'none' }}
        />
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", getBadgeClass())}>
          {typeLabel}
        </span>
      </dd>

      <dt className="font-medium text-gray-500">{t('callLogs.number')}</dt>
      <dd className="text-gray-900">{data.number || '-'}</dd>

      <dt className="font-medium text-gray-500">{t('callLogs.contact')}</dt>
      <dd className="text-gray-900">{data.contactName || '-'}</dd>

      <dt className="font-medium text-gray-500">{t('callLogs.date')}</dt>
      <dd className="text-gray-900">{data.date ? formatDate(data.date) : '-'}</dd>

      <dt className="font-medium text-gray-500">{t('callLogs.duration')}</dt>
      <dd className="text-gray-900">{data.duration > 0 ? formatDuration(data.duration) : '-'}</dd>
    </dl>
  );
};

function parseJsonArray(val: any): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

export default VersionPreview;
