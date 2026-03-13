import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  Monitor,
  Folder,
  Phone,
  MessageSquare,
  Users,
  Zap,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore, type SyncStatus } from '../stores/useStore';
import { formatFileSize, formatRelativeTime } from '../utils/format';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { useToast } from '../components/ui/toast';
import { cn } from '../utils/cn';

interface Stats {
  contactCount: number;
  messageCount: number;
  callLogCount: number;
}

interface Activity {
  id: string;
  type: string;
  action: string;
  timestamp: string;
  status: 'success' | 'error';
}

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { connectedDevice, syncStatuses, companionInstalled, setShowCompanionPrompt } = useStore();
  const [stats, setStats] = useState<Stats>({
    contactCount: 0,
    messageCount: 0,
    callLogCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    if (connectedDevice && companionInstalled !== false) {
      loadStats();
    }
  }, [connectedDevice, companionInstalled]);

  useEffect(() => {
    if (connectedDevice) {
      loadActivities();
    }
  }, [connectedDevice, syncStatuses]);

  const loadStats = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const [contacts, messages, callLogs] = await Promise.all([
        tauriInvoke<any[]>('get_contacts', { serial: connectedDevice.serial }),
        tauriInvoke<any[]>('get_messages', { serial: connectedDevice.serial }),
        tauriInvoke<any[]>('get_call_logs', { serial: connectedDevice.serial }),
      ]);
      setStats({
        contactCount: contacts?.length || 0,
        messageCount: messages?.length || 0,
        callLogCount: callLogs?.length || 0,
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
      toast.error(t('dashboard.loadStatsFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadActivities = async () => {
    // 从 syncStatuses 中提取真实的同步记录
    // Build activity list from actual sync statuses
    const realActivities: Activity[] = [];
    const typeLabels: Record<string, string> = {
      contacts: t('dashboard.syncContacts'),
      messages: t('dashboard.syncMessages'),
      call_logs: t('dashboard.syncCallLogs'),
    };
    for (const [type, label] of Object.entries(typeLabels)) {
      const status = syncStatuses?.[type] as (SyncStatus & { status?: string; lastSync?: string }) | undefined;
      if (status?.lastSync && status?.status) {
        realActivities.push({
          id: type,
          type,
          action: label,
          timestamp: status.lastSync,
          status: status.status === 'error' ? 'error' : 'success',
        });
      }
    }
    // 按时间倒序排列 / Sort by time descending
    realActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setActivities(realActivities);
  };

  const handleSyncAll = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', { serial: connectedDevice.serial });
      toast.success(t('dashboard.syncAllStarted'));
      setTimeout(() => {
        loadStats();
        loadActivities();
      }, 2000);
    } catch (error) {
      toast.error(t('common.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleScreenMirror = () => {
    toast.info(t('dashboard.startMirrorMsg'));
  };

  const handleFileManager = () => {
    toast.info(t('dashboard.openFileManagerMsg'));
  };

  const getSyncStatusIcon = (status?: string) => {
    switch (status) {
      case 'syncing':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-error" />;
      default:
        return <Clock className="h-4 w-4 text-gray-300" />;
    }
  };

  const getSyncStatusText = (status?: string) => {
    switch (status) {
      case 'syncing':
        return t('dashboard.syncing');
      case 'success':
        return t('dashboard.syncComplete');
      case 'error':
        return t('dashboard.syncError');
      default:
        return t('dashboard.notSynced');
    }
  };

  if (!connectedDevice) {
    return (
      <div className="text-center py-24 px-5">
        <div className="text-center py-12 text-gray-400">
          <div className="flex flex-col items-center gap-6">
            <h3 className="text-[var(--font-size-title)] font-semibold text-gray-900">
              {t('common.connectDeviceTitle')}
            </h3>
            <span className="text-gray-500">{t('dashboard.connectDeviceDesc')}</span>
          </div>
        </div>
      </div>
    );
  }

  const storagePercent = connectedDevice.storageTotal && connectedDevice.storageUsed
    ? (connectedDevice.storageUsed / connectedDevice.storageTotal) * 100
    : 0;

  return (
    <div className="p-[var(--page-padding)] relative">
      {loading && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      <h2 className="text-[var(--font-size-title)] font-semibold mb-6">{t('dashboard.title')}</h2>

      {/* Companion app not installed notice */}
      {companionInstalled === false && (
        <div className="rounded-[var(--border-radius)] border border-amber-200 bg-amber-50 p-[var(--card-padding)] mb-[var(--card-gap)] flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-amber-900 text-[var(--font-size-base)]">{t('common.companionRequired')}</div>
            <div className="text-amber-700 text-[var(--font-size-sm)] mt-1">{t('common.companionRequiredDesc')}</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowCompanionPrompt(true)}>
            {t('common.installCompanion')}
          </Button>
        </div>
      )}

      {/* 设备信息卡片 / Device Info Card */}
      <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)] mb-[var(--card-gap)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-6 w-6" style={{ color: '#3ddc84' }} />
            <span className="font-semibold text-[var(--font-size-base)]">
              {connectedDevice.displayName || connectedDevice.model}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-success"></span>
            <span className="text-success text-[var(--font-size-sm)]">{t('dashboard.connected')}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.model')}</div>
            <div className="text-[var(--font-size-base)] font-semibold">{connectedDevice.model}</div>
          </div>
          <div>
            <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.android')}</div>
            <div className="text-[var(--font-size-base)] font-semibold">
              {connectedDevice.androidVersion || 'N/A'}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-5 w-5 text-success" />
              <span className="text-gray-500 text-[var(--font-size-xs)]">{t('dashboard.battery')}</span>
            </div>
            <div className="text-[var(--font-size-base)] font-semibold">
              {connectedDevice.batteryLevel || 0}%
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.serial')}</div>
            <div>
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[var(--font-size-xs)]">
                {connectedDevice.serial}
              </code>
            </div>
          </div>
        </div>

        <hr className="border-border my-4" />

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-[var(--font-size-base)]">{t('dashboard.storage')}</span>
            <span className="text-gray-500 text-[var(--font-size-sm)]">
              {formatFileSize(connectedDevice.storageUsed)} /{' '}
              {formatFileSize(connectedDevice.storageTotal)}
            </span>
          </div>
          <Progress
            value={Math.round(storagePercent)}
            className={cn(storagePercent > 90 && 'bg-error')}
          />
        </div>
      </div>

      {/* 数据统计卡片 / Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-[var(--card-gap)]">
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
          <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.contacts')}</div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <div className="text-lg font-semibold text-primary">{stats.contactCount}</div>
          </div>
        </div>
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
          <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.messages')}</div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-success" />
            <div className="text-lg font-semibold text-success">{stats.messageCount}</div>
          </div>
        </div>
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
          <div className="text-gray-500 text-[var(--font-size-xs)] mb-1">{t('dashboard.callLogs')}</div>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-warning" />
            <div className="text-lg font-semibold text-warning">{stats.callLogCount}</div>
          </div>
        </div>
      </div>

      {/* 快捷操作 / Quick Actions */}
      <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)] mb-[var(--card-gap)]">
        <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('dashboard.quickActions')}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="primary"
            size="lg"
            loading={syncing}
            onClick={handleSyncAll}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('dashboard.syncAll')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={handleScreenMirror}
          >
            <Monitor className="h-4 w-4 mr-2" />
            {t('dashboard.startMirror')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={handleFileManager}
          >
            <Folder className="h-4 w-4 mr-2" />
            {t('dashboard.openFileManager')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 同步状态 / Sync Status */}
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
          <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('dashboard.syncStatus')}</div>
          <div className="flex flex-col gap-3">
            {['contacts', 'messages', 'call_logs', 'folders'].map((type) => {
              const status = syncStatuses?.[type] as (SyncStatus & { status?: string; lastSync?: string }) | undefined;
              const labelKey = `dashboard.${type === 'call_logs' ? 'callLogs' : type === 'folders' ? 'folderSync' : type}`;
              return (
                <div
                  key={type}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-2">
                    {getSyncStatusIcon(status?.status)}
                    <span className="font-semibold text-[var(--font-size-sm)]">{t(labelKey)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-[var(--font-size-xs)]">
                      {status?.lastSync
                        ? formatRelativeTime(status.lastSync)
                        : t('dashboard.neverSynced')}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        status?.status === 'success'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-50 text-gray-700'
                      )}
                    >
                      {getSyncStatusText(status?.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 最近活动 / Recent Activity */}
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
          <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('dashboard.recentActivity')}</div>
          {activities.length > 0 ? (
            <div className="relative pl-6">
              {activities.map((activity, index) => (
                <div key={activity.id} className="relative pb-6 last:pb-0">
                  {index !== activities.length - 1 && (
                    <span
                      className="absolute left-[-18px] top-2 h-full w-0.5 bg-gray-200"
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-start">
                    <span
                      className={cn(
                        'absolute left-[-22px] top-1.5 h-2 w-2 rounded-full',
                        activity.status === 'success' ? 'bg-success' : 'bg-error'
                      )}
                    />
                    <div className="flex-1">
                      <span className="font-semibold text-[var(--font-size-sm)]">{activity.action}</span>
                      <br />
                      <span className="text-gray-500 text-[var(--font-size-xs)]">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">{t('dashboard.noActivity')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
