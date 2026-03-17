import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/format';
import { cn } from '../utils/cn';

interface VersionDiffViewProps {
  dataType: string;
  versionA: any;
  versionB: any;
  timestampA: string;
  timestampB: string;
  actionA?: string;
  actionB?: string;
}

interface FieldDef {
  key: string;
  label: string;
  render?: (val: any) => React.ReactNode;
}

/**
 * Version diff component - side-by-side comparison with highlighted changes
 */
export const VersionDiffView: React.FC<VersionDiffViewProps> = ({
  dataType, versionA, versionB, timestampA, timestampB, actionA, actionB,
}) => {
  const { t } = useTranslation();

  const fields = useMemo(() => getFieldDefs(dataType, t), [dataType, t]);

  const diffs = useMemo(() => {
    if (!versionA && !versionB) return [];
    return fields.map((field) => {
      const valA = getNestedValue(versionA, field.key);
      const valB = getNestedValue(versionB, field.key);
      const strA = normalizeValue(valA);
      const strB = normalizeValue(valB);
      const changed = strA !== strB;
      const added = !strA && strB;
      const removed = strA && !strB;
      return { ...field, valA, valB, strA, strB, changed, added, removed };
    });
  }, [fields, versionA, versionB]);

  if (!versionA && !versionB) {
    return (
      <div className="text-center py-12 text-gray-400">
        {t('versionHistory.noChanges')}
      </div>
    );
  }

  const hasChanges = diffs.some(d => d.changed);

  return (
    <div>
      {/* Version headers */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="rounded-md bg-orange-50 border border-orange-200 p-3">
          <span className="font-semibold">{t('versionHistory.versionA')}</span>
          {actionA && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 ml-2">
              {actionA}
            </span>
          )}
          <br />
          <span className="text-gray-500 text-xs">{formatDate(timestampA)}</span>
        </div>
        <div className="rounded-md bg-green-50 border border-green-200 p-3">
          <span className="font-semibold">{t('versionHistory.versionB')}</span>
          {actionB && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 ml-2">
              {actionB}
            </span>
          )}
          <br />
          <span className="text-gray-500 text-xs">{formatDate(timestampB)}</span>
        </div>
      </div>

      {!hasChanges && (
        <div className="text-center py-6">
          <span className="text-gray-400">{t('versionHistory.noChanges')}</span>
        </div>
      )}

      {/* Field-by-field comparison */}
      {diffs.map((diff) => {
        if (!diff.changed) return null;

        const renderVal = diff.render || ((v: any) => <span>{normalizeValue(v) || '-'}</span>);

        let statusTag: React.ReactNode;
        if (diff.added) {
          statusTag = (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
              {t('versionHistory.fieldAdded')}
            </span>
          );
        } else if (diff.removed) {
          statusTag = (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
              {t('versionHistory.fieldRemoved')}
            </span>
          );
        } else {
          statusTag = (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700">
              {t('versionHistory.fieldChanged')}
            </span>
          );
        }

        return (
          <div key={diff.key} className="mb-3">
            <div className="mb-1">
              <span className="font-semibold text-[var(--font-size-sm)]">{diff.label}</span>{' '}
              {statusTag}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div
                className={cn(
                  "p-3 rounded-md border min-h-[36px] break-words",
                  diff.removed
                    ? "bg-red-50 border-red-200"
                    : diff.changed
                    ? "bg-orange-50 border-orange-200"
                    : "bg-gray-50 border-gray-200"
                )}
              >
                {diff.valA != null ? renderVal(diff.valA) : <span className="text-gray-400">-</span>}
              </div>
              <div
                className={cn(
                  "p-3 rounded-md border min-h-[36px] break-words",
                  diff.added
                    ? "bg-green-50 border-green-200"
                    : diff.changed
                    ? "bg-green-50 border-green-200"
                    : "bg-gray-50 border-gray-200"
                )}
              >
                {diff.valB != null ? renderVal(diff.valB) : <span className="text-gray-400">-</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

function getFieldDefs(dataType: string, t: (key: string) => string): FieldDef[] {
  switch (dataType) {
    case 'contacts':
      return [
        { key: 'displayName', label: t('contacts.name') },
        { key: 'phoneNumbers', label: t('contacts.phone'), render: renderJsonArray },
        { key: 'emails', label: t('contacts.email'), render: renderJsonArray },
        { key: 'organization', label: t('contacts.organization') },
      ];
    case 'messages':
      return [
        { key: 'address', label: t('messages.address') },
        { key: 'contactName', label: t('messages.contact') },
        { key: 'body', label: t('messages.body') },
        { key: 'date', label: t('messages.date'), render: (v: any) => <span>{v ? formatDate(v) : '-'}</span> },
        {
          key: 'msgType',
          label: t('messages.type'),
          render: (v: any) => (
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", v === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-green-50 text-green-700')}>
              {v === 2 ? t('messages.sent') : t('messages.received')}
            </span>
          ),
        },
      ];
    case 'call_logs':
      return [
        { key: 'number', label: t('callLogs.number') },
        { key: 'contactName', label: t('callLogs.contact') },
        { key: 'callType', label: t('callLogs.type'), render: renderCallType(t) },
        { key: 'date', label: t('callLogs.date'), render: (v: any) => <span>{v ? formatDate(v) : '-'}</span> },
        { key: 'duration', label: t('callLogs.duration'), render: (v: any) => <span>{v > 0 ? `${v}s` : '-'}</span> },
      ];
    default:
      return [{ key: '_raw', label: 'Data' }];
  }
}

function renderJsonArray(val: any): React.ReactNode {
  let arr: string[] = [];
  if (Array.isArray(val)) arr = val;
  else if (typeof val === 'string') {
    try { arr = JSON.parse(val); } catch { arr = [val]; }
  }
  if (arr.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <>
      {arr.map((item, i) => (
        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 mr-1">
          {item}
        </span>
      ))}
    </>
  );
}

function renderCallType(t: (key: string) => string) {
  return (val: any) => {
    const type = Number(val);
    const label = type === 1 ? t('callLogs.incoming')
      : type === 2 ? t('callLogs.outgoing')
      : type === 3 ? t('callLogs.missed')
      : t('callLogs.other');
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
        {label}
      </span>
    );
  };
}

function getNestedValue(obj: any, key: string): any {
  if (!obj) return undefined;
  if (key === '_raw') return obj;
  return obj[key];
}

function normalizeValue(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export default VersionDiffView;
