import React, { useEffect, useState, useCallback } from 'react';
import {
  Download,
  RefreshCw,
  Phone,
  RotateCw,
  History,
  Eye,
  Undo2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatDuration, callTypeText, callTypeColor, safeJsonParse } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogBody } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu';
import { cn } from '../utils/cn';

interface CallLog {
  id: string;
  number: string;
  contactName?: string;
  callType: number; // 1=incoming, 2=outgoing, 3=missed
  date: string;
  duration: number; // seconds
}

interface Version {
  id: string;
  createdAt: string;
  action: string;
  description?: string;
  source: string;
  dataBefore?: string;
  dataAfter?: string;
}

type CallTypeFilter = 'all' | 'incoming' | 'outgoing' | 'missed';

export const CallLogs: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice, companionInstalled, setShowCompanionPrompt } = useStore();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [typeFilter, setTypeFilter] = useState<CallTypeFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Version history
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [versionHistory, setVersionHistory] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);

  const loadCallLogs = useCallback(async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<CallLog[]>('get_call_logs', {
        serial: connectedDevice.serial,
      });
      setCallLogs(data || []);
    } catch (error) {
      console.error('Failed to load call logs:', error);
      toast.error(t('callLogs.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [connectedDevice, toast, t]);

  useEffect(() => {
    if (connectedDevice) {
      loadCallLogs();
    }
  }, [connectedDevice, loadCallLogs]);

  useEffect(() => {
    if (typeFilter === 'all') {
      setFilteredLogs(callLogs);
      return;
    }
    const typeMap: Record<CallTypeFilter, number> = {
      all: 0,
      incoming: 1,
      outgoing: 2,
      missed: 3,
    };
    const filtered = callLogs.filter((log) => log.callType === typeMap[typeFilter]);
    setFilteredLogs(filtered);
  }, [typeFilter, callLogs]);

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'call_logs',
      });
      toast.success(t('callLogs.syncStarted'));
      setTimeout(loadCallLogs, 2000);
    } catch (error) {
      toast.error(t('common.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (format: string) => {
    if (!connectedDevice) return;
    setExporting(true);
    try {
      const path = await tauriInvoke<string>('export_call_logs', {
        serial: connectedDevice.serial,
        format,
        outputPath: `call_logs_export_${Date.now()}.${format}`,
      });
      toast.success(t('callLogs.exportSuccess', { path }));
    } catch (error) {
      toast.error(t('common.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleShowVersionHistory = async () => {
    setVersionModalVisible(true);
    setLoadingVersions(true);
    try {
      const history = await tauriInvoke<Version[]>('get_version_history', {
        dataType: 'call_logs',
      });
      setVersionHistory(history || []);
    } catch (error) {
      toast.error(t('versionHistory.loadFailed'));
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleViewVersionDetail = async (versionId: string) => {
    try {
      const detail = await tauriInvoke<any>('get_version_detail', { versionId });
      setSelectedVersionDetail(detail);
      setDetailModalVisible(true);
    } catch (error) {
      toast.error(t('versionHistory.loadDetailFailed'));
    }
  };

  const handleRestoreVersion = (versionId: string, description: string) => {
    confirm({
      title: t('versionHistory.restoreConfirmTitle'),
      content: t('versionHistory.restoreConfirm', { description }),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          toast.success(t('versionHistory.restored'));
          loadCallLogs();
        } catch (error) {
          toast.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add')) return 'success';
    if (a.includes('update') || a.includes('modify')) return 'warning';
    if (a.includes('delete') || a.includes('remove')) return 'error';
    if (a.includes('restore')) return 'warning';
    return 'default';
  };

  const getActionBadgeClass = (color: string) => {
    switch (color) {
      case 'success':
        return 'bg-green-50 text-green-700';
      case 'warning':
        return 'bg-emerald-50 text-emerald-700';
      case 'error':
        return 'bg-red-50 text-red-700';
      default:
        return 'bg-gray-50 text-gray-700';
    }
  };

  const getActionDotClass = (color: string) => {
    switch (color) {
      case 'success':
        return 'bg-green-500';
      case 'warning':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getCallTypeIcon = (type: number) => {
    const color = callTypeColor(type);
    const rotation =
      type === 1 ? 'rotate(135deg)' : type === 2 ? 'rotate(-45deg)' : 'rotate(0deg)';
    return (
      <Phone
        className="w-4 h-4 inline-block"
        style={{ color, transform: rotation }}
      />
    );
  };

  const getCallTypeBadgeClass = (type: number) => {
    const color = callTypeColor(type);
    if (color === '#52c41a') return 'bg-green-50 text-green-700';
    if (color === '#059669') return 'bg-emerald-50 text-emerald-700';
    if (color === '#ff4d4f') return 'bg-red-50 text-red-700';
    return 'bg-gray-50 text-gray-700';
  };

  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const totalPages = Math.ceil(filteredLogs.length / pageSize);

  if (!connectedDevice) {
    return (
      <div className="flex items-center justify-center" style={{ padding: '100px 20px' }}>
        <div className="text-center py-12 text-gray-400">
          <h3 className="text-[var(--font-size-lg)] font-semibold mb-2 text-gray-900">
            {t('common.connectDeviceTitle')}
          </h3>
          <p className="text-[var(--font-size-base)]">{t('callLogs.connectDeviceDesc')}</p>
        </div>
      </div>
    );
  }

  if (companionInstalled === false) {
    return (
      <div className="flex items-center justify-center" style={{ padding: '100px 20px' }}>
        <div className="text-center py-12 text-gray-400">
          <h3 className="text-[var(--font-size-lg)] font-semibold mb-2 text-gray-900">
            {t('common.companionRequired')}
          </h3>
          <p className="text-[var(--font-size-base)] mb-4">{t('common.companionRequiredDesc')}</p>
          <Button variant="primary" onClick={() => setShowCompanionPrompt(true)}>
            {t('common.installCompanion')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--page-padding)' }}>
      <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
        <div className="flex justify-between items-center flex-wrap gap-4 mb-[var(--section-gap)]">
          <h2 className="text-[var(--font-size-title)] font-semibold m-0">
            {t('callLogs.title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {/* Type filter button group */}
            <div className="inline-flex rounded-md shadow-sm" role="group">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={cn(
                  "px-3 py-2 text-[var(--font-size-sm)] font-medium border rounded-l-md",
                  typeFilter === 'all'
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                )}
              >
                {t('callLogs.all')}
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('incoming')}
                className={cn(
                  "px-3 py-2 text-[var(--font-size-sm)] font-medium border-t border-b",
                  typeFilter === 'incoming'
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                )}
              >
                {t('callLogs.incoming')}
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('outgoing')}
                className={cn(
                  "px-3 py-2 text-[var(--font-size-sm)] font-medium border-t border-b",
                  typeFilter === 'outgoing'
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                )}
              >
                {t('callLogs.outgoing')}
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('missed')}
                className={cn(
                  "px-3 py-2 text-[var(--font-size-sm)] font-medium border rounded-r-md",
                  typeFilter === 'missed'
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                )}
              >
                {t('callLogs.missed')}
              </button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" loading={exporting}>
                  <Download className="w-4 h-4 mr-2" />
                  {t('common.export')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExport('json')}>
                  {t('common.jsonFormat')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  {t('common.csvFormat')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('txt')}>
                  {t('common.txtFormat')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={handleShowVersionHistory}>
              <History className="w-4 h-4 mr-2" />
              {t('versionHistory.title')}
            </Button>
            <Button variant="outline" loading={syncing} onClick={handleSync}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('common.sync')}
            </Button>
            <Button variant="outline" onClick={loadCallLogs}>
              <RotateCw className="w-4 h-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RotateCw className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-left text-[var(--font-size-base)]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)] w-[120px]">
                      {t('callLogs.type')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('callLogs.number')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('callLogs.contact')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('callLogs.date')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('callLogs.duration')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.map((log) => (
                    <tr key={log.id} className="border-b border-border hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {getCallTypeIcon(log.callType)}
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[var(--font-size-xs)] font-medium", getCallTypeBadgeClass(log.callType))}>
                            {callTypeText(log.callType)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono">{log.number}</span>
                      </td>
                      <td className="px-3 py-2">
                        {log.contactName || <span className="text-gray-400">{t('callLogs.unknownContact')}</span>}
                      </td>
                      <td className="px-3 py-2">{formatDate(log.date)}</td>
                      <td className="px-3 py-2">
                        {log.duration > 0 ? formatDuration(log.duration) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredLogs.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                {t('callLogs.noData')}
              </div>
            )}

            {filteredLogs.length > 0 && (
              <div className="mt-4 flex items-center justify-between text-[var(--font-size-sm)]">
                <div className="text-gray-500">
                  {t('common.totalRecords', { total: filteredLogs.length })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-gray-500">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Version history modal */}
      <Dialog open={versionModalVisible} onOpenChange={setVersionModalVisible}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <History className="w-5 h-5" />
                {t('versionHistory.title')} - {t('versionHistory.callLogs')}
              </div>
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {loadingVersions ? (
              <div className="flex items-center justify-center py-20">
                <RotateCw className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : versionHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                {t('versionHistory.noVersions')}
              </div>
            ) : (
              <div className="space-y-3">
                {versionHistory.map((v) => {
                  const color = getActionColor(v.action);
                  return (
                    <div key={v.id} className="flex gap-3">
                      <div className={cn("w-2 h-2 mt-2 rounded-full shrink-0", getActionDotClass(color))} />
                      <div className="flex-1">
                        <div className="rounded-[var(--border-radius)] border border-border bg-white p-3 text-[var(--font-size-sm)]">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[var(--font-size-xs)] font-medium", getActionBadgeClass(color))}>
                                {v.action}
                              </span>
                              <span>{v.description}</span>
                              <span className="text-gray-400 text-[var(--font-size-xs)]">{formatDate(v.createdAt)}</span>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleViewVersionDetail(v.id)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleRestoreVersion(v.id, v.description || '')}>
                                <Undo2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionModalVisible(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version detail modal */}
      <Dialog open={detailModalVisible} onOpenChange={setDetailModalVisible}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('versionHistory.detail')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {selectedVersionDetail && (() => {
              const record = selectedVersionDetail?.record || selectedVersionDetail;
              const beforeData = safeJsonParse(record?.dataBefore);
              const afterData = safeJsonParse(record?.dataAfter);
              return (
                <>
                  {beforeData && (
                    <>
                      <h5 className="text-[var(--font-size-base)] font-semibold mb-2">{t('versionHistory.before')}</h5>
                      <VersionPreview dataType="call_logs" data={beforeData} />
                    </>
                  )}
                  {afterData && (
                    <>
                      <h5 className="text-[var(--font-size-base)] font-semibold mb-2 mt-4">{t('versionHistory.after')}</h5>
                      <VersionPreview dataType="call_logs" data={afterData} />
                    </>
                  )}
                </>
              );
            })()}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDetailModalVisible(false);
                setSelectedVersionDetail(null);
              }}
            >
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
