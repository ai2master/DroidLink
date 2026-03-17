import { useMemo } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';

const syncingStyle = { color: '#059669' };
const connectedStyle = { color: '#52c41a' };
const disconnectedStyle = { color: '#d9d9d9' };

export default function StatusBar() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const syncStatuses = useStore((s) => s.syncStatuses);

  const activeSyncs = useMemo(
    () => Object.values(syncStatuses).filter((s) => s.type === 'started' || s.type === 'progress'),
    [syncStatuses],
  );

  const dataTypeLabels = useMemo<Record<string, string>>(
    () => ({
      contacts: t('statusBar.contacts'),
      messages: t('statusBar.messages'),
      call_logs: t('statusBar.callLogs'),
    }),
    [t],
  );

  return (
    <div className="status-bar">
      <div className="sync-indicator">
        {activeSyncs.length > 0 ? (
          <>
            <RefreshCw className="animate-spin" style={syncingStyle} />
            <span>
              {t('statusBar.syncing', { types: activeSyncs.map((s) => dataTypeLabels[s.dataType] || s.dataType).join(', ') })}
              {activeSyncs[0]?.current != null && activeSyncs[0]?.total != null && (
                <span> ({activeSyncs[0].current}/{activeSyncs[0].total})</span>
              )}
            </span>
          </>
        ) : device ? (
          <>
            <CheckCircle2 style={connectedStyle} />
            <span>{t('statusBar.connected')}</span>
          </>
        ) : (
          <>
            <XCircle style={disconnectedStyle} />
            <span>{t('statusBar.disconnected')}</span>
          </>
        )}
      </div>
      <div>
        {device && (
          <span>
            {device.displayName} | Android {device.androidVersion} |{' '}
            {t('statusBar.battery')} {device.batteryLevel}%
          </span>
        )}
      </div>
    </div>
  );
}
