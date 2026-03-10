import { SyncOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';

export default function StatusBar() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const syncStatuses = useStore((s) => s.syncStatuses);

  const activeSyncs = Object.values(syncStatuses).filter(
    (s) => s.type === 'started' || s.type === 'progress'
  );

  // 数据类型标签映射 / Data type label mapping
  const dataTypeLabels: Record<string, string> = {
    contacts: t('statusBar.contacts'),
    messages: t('statusBar.messages'),
    call_logs: t('statusBar.callLogs'),
  };

  return (
    <div className="status-bar">
      <div className="sync-indicator">
        {activeSyncs.length > 0 ? (
          <>
            <SyncOutlined spin style={{ color: '#1677ff' }} />
            <span>
              {t('statusBar.syncing', { types: activeSyncs.map((s) => dataTypeLabels[s.dataType] || s.dataType).join(', ') })}
              {activeSyncs[0]?.current != null && activeSyncs[0]?.total != null && (
                <span> ({activeSyncs[0].current}/{activeSyncs[0].total})</span>
              )}
            </span>
          </>
        ) : device ? (
          <>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <span>{t('statusBar.connected')}</span>
          </>
        ) : (
          <>
            <CloseCircleOutlined style={{ color: '#d9d9d9' }} />
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
