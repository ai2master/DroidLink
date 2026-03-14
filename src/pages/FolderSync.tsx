import React, { useState, useEffect } from 'react';
import {
  RefreshCw, Plus, Trash2, Play, ArrowLeftRight, ArrowRight, ArrowLeft, FolderOpen,
  Settings, AlertTriangle, Zap, Clock, FileText, Eraser, Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke, tauriListen } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatRelativeTime } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Input, Textarea } from '../components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { cn } from '../utils/cn';

interface SyncPair {
  id: string;
  deviceSerial: string;
  localPath: string;
  remotePath: string;
  direction: string;
  enabled: boolean;
  lastSynced: string | null;
  createdAt: string;
}

interface SyncProgress {
  pairId: string;
  current?: number;
  total?: number;
  file?: string;
  action?: string;
  bytes?: number;
  type?: string;
  result?: SyncResultData;
  message?: string;
}

interface SyncResultData {
  pushed: number;
  pulled: number;
  deleted_local: number;
  deleted_remote: number;
  conflicts: number;
  skipped: number;
  errors: string[];
  bytes_pushed: number;
  bytes_pulled: number;
  duration_ms: number;
  speed_mbps: number;
}

interface TransferInfo {
  usb_speed: string;
  estimated_speed: string;
  max_file_size: string;
  filesystem: string;
  has_fat32_limit: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
}

export default function FolderSync() {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm } = useConfirm();
  const device = useStore((s) => s.connectedDevice);
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [newPair, setNewPair] = useState({
    localPath: '', remotePath: '/sdcard/', direction: 'bidirectional', conflictPolicy: 'keep_both',
  });
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({});
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [lastResults, setLastResults] = useState<Record<string, SyncResultData>>({});
  const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [ignoreVisible, setIgnoreVisible] = useState(false);
  const [ignoreContent, setIgnoreContent] = useState('');
  const [ignoreLocalPath, setIgnoreLocalPath] = useState('');
  const [cleanupVisible, setCleanupVisible] = useState(false);
  const [cleanupPath, setCleanupPath] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const directionLabel: Record<string, { text: string; icon: React.ReactNode; color: string }> = {
    bidirectional: { text: t('folderSync.bidirectional'), icon: <ArrowLeftRight size={14} />, color: 'default' },
    push: { text: t('folderSync.pushToPhone'), icon: <ArrowRight size={14} />, color: 'success' },
    pull: { text: t('folderSync.pullToPC'), icon: <ArrowLeft size={14} />, color: 'warning' },
  };

  const conflictPolicies = [
    { value: 'keep_both', label: t('folderSync.keepBoth') },
    { value: 'local_wins', label: t('folderSync.localWins') },
    { value: 'remote_wins', label: t('folderSync.remoteWins') },
    { value: 'newest_wins', label: t('folderSync.newestWins') },
  ];

  const loadPairs = async () => {
    setLoading(true);
    try {
      const result = await tauriInvoke<SyncPair[]>('get_folder_sync_pairs');
      setPairs(result);
    } catch (err: any) {
      toast.error(t('folderSync.loadFailed', { error: err }));
    } finally {
      setLoading(false);
    }
  };

  const loadTransferInfo = async () => {
    if (!device) return;
    setLoadingInfo(true);
    try {
      const info = await tauriInvoke<TransferInfo>('get_transfer_info', { serial: device.serial });
      setTransferInfo(info);
    } catch (err: any) {
      console.warn('Failed to load transfer info:', err);
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    loadPairs();
    loadTransferInfo();
    const unlisten = tauriListen<SyncProgress>('folder-sync-progress', (data) => {
      setProgress((prev) => ({ ...prev, [data.pairId]: data }));
      if (data.type === 'completed' || data.type === 'error') {
        setSyncing((prev) => {
          const next = new Set(prev);
          next.delete(data.pairId);
          return next;
        });
        if (data.type === 'completed' && data.result) {
          const r = data.result;
          setLastResults((prev) => ({ ...prev, [data.pairId]: r }));
          toast.success(
            t('folderSync.syncComplete', {
              pushed: r.pushed,
              pulled: r.pulled,
              deleted: r.deleted_local + r.deleted_remote,
            }) + ` ${formatBytes(r.bytes_pushed + r.bytes_pulled)} @ ${r.speed_mbps.toFixed(1)} MB/s`
          );
        }
        if (data.type === 'error') {
          toast.error(t('folderSync.syncFailed', { error: data.message }));
        }
        loadPairs();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (device) loadTransferInfo();
  }, [device?.serial]);

  const handleAdd = async () => {
    if (!newPair.localPath || !newPair.remotePath || !device) {
      toast.warning(t('folderSync.fillComplete'));
      return;
    }
    try {
      await tauriInvoke('add_folder_sync_pair', {
        pair: {
          deviceSerial: device.serial,
          localPath: newPair.localPath,
          remotePath: newPair.remotePath,
          direction: newPair.direction,
          conflictPolicy: newPair.conflictPolicy,
        },
      });
      toast.success(t('folderSync.pairAdded'));
      setAddVisible(false);
      setNewPair({ localPath: '', remotePath: '/sdcard/', direction: 'bidirectional', conflictPolicy: 'keep_both' });
      loadPairs();
    } catch (err: any) {
      toast.error(t('folderSync.addFailed', { error: err }));
    }
  };

  const handleRemove = async (id: string) => {
    confirm({
      title: t('folderSync.deleteConfirm'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      onOk: async () => {
        try {
          await tauriInvoke('remove_folder_sync_pair', { pairId: id });
          toast.success(t('folderSync.deleted'));
          loadPairs();
        } catch (err: any) {
          toast.error(t('folderSync.removeFailed', { error: err }));
        }
      },
    });
  };

  const handleSync = async (id: string) => {
    setSyncing((prev) => new Set(prev).add(id));
    try {
      await tauriInvoke('trigger_folder_sync', { pairId: id });
    } catch (err: any) {
      toast.error(t('folderSync.syncFailed', { error: err }));
      setSyncing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const selectLocalPath = async () => {
    const path = await open({ directory: true, title: t('folderSync.selectLocalFolder') });
    if (path) setNewPair((p) => ({ ...p, localPath: path as string }));
  };

  const openIgnoreEditor = async (localPath: string) => {
    setIgnoreLocalPath(localPath);
    try {
      const ignorePath = localPath.replace(/\/$/, '') + '/.droidlinkignore';
      try {
        const content = await tauriInvoke<string>('read_text_file', { path: ignorePath });
        setIgnoreContent(content);
      } catch {
        setIgnoreContent(
          '# DroidLink ignore rules (similar to Syncthing .stignore)\n' +
          '# One rule per line, supports glob wildcards\n' +
          '# Lines starting with ! un-ignore (force include)\n' +
          '# Lines starting with # are comments\n' +
          '#\n' +
          '# Examples:\n' +
          '# *.tmp\n' +
          '# node_modules/\n' +
          '# .git/\n' +
          '# !important.tmp\n'
        );
      }
    } catch {
      setIgnoreContent('');
    }
    setIgnoreVisible(true);
  };

  const saveIgnoreFile = async () => {
    try {
      const ignorePath = ignoreLocalPath.replace(/\/$/, '') + '/.droidlinkignore';
      await tauriInvoke('write_text_file', { path: ignorePath, content: ignoreContent });
      toast.success(t('folderSync.ignoreRulesSaved'));
      setIgnoreVisible(false);
    } catch (err: any) {
      toast.error(t('folderSync.saveFailed', { error: err }));
    }
  };

  const handleCleanVersions = async () => {
    setCleaningUp(true);
    try {
      const count = await tauriInvoke<number>('clean_folder_versions', {
        localPath: cleanupPath,
        retentionDays,
      });
      toast.success(t('folderSync.cleaned', { count }));
      setCleanupVisible(false);
    } catch (err: any) {
      toast.error(t('folderSync.cleanFailed', { error: err }));
    } finally {
      setCleaningUp(false);
    }
  };

  if (!device) {
    return (
      <>
        <div className="page-header"><h2>{t('folderSync.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <div className="text-center py-12 text-gray-400">{t('common.connectDevice')}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>{t('folderSync.title')}</h2>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setAddVisible(true)}>
            <Plus size={16} />
            {t('folderSync.addPair')}
          </Button>
        </div>
      </div>
      <div className="page-body">
        {transferInfo && (
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)] mb-[var(--card-gap)]">
            <div className="grid grid-cols-5 gap-4">
              <div>
                <div className="text-gray-500 text-[var(--font-size-xs)]">{t('folderSync.transferInfo.usbSpeed')}</div>
                <div className="text-base font-semibold flex items-center gap-1">
                  <Zap size={16} className="text-yellow-500" />
                  {transferInfo.usb_speed}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-[var(--font-size-xs)]">{t('folderSync.transferInfo.estimatedSpeed')}</div>
                <div className="text-base font-semibold">{transferInfo.estimated_speed}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[var(--font-size-xs)]">{t('folderSync.transferInfo.filesystem')}</div>
                <div className="text-base font-semibold">{transferInfo.filesystem}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[var(--font-size-xs)]">{t('folderSync.transferInfo.maxFileSize')}</div>
                <div className={cn("text-base font-semibold", transferInfo.has_fat32_limit && "text-red-500")}>
                  {transferInfo.max_file_size}
                </div>
              </div>
              <div className="flex items-center">
                {transferInfo.has_fat32_limit && (
                  <div className="flex gap-2 p-2 rounded-[var(--border-radius)] bg-yellow-50 border border-yellow-200 text-[var(--font-size-xs)]">
                    <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                    <span className="text-yellow-800">{t('folderSync.transferInfo.fat32Warning')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-left text-[var(--font-size-base)]">
          <thead>
            <tr className="border-b border-border bg-gray-50">
              <th className="p-3 font-semibold">{t('folderSync.localPath')}</th>
              <th className="p-3 font-semibold w-[140px]">{t('folderSync.direction')}</th>
              <th className="p-3 font-semibold">{t('folderSync.remotePath')}</th>
              <th className="p-3 font-semibold w-[160px]">{t('folderSync.lastSynced')}</th>
              <th className="p-3 font-semibold w-[260px]">{t('common.status')}</th>
              <th className="p-3 font-semibold w-[160px]">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400">{t('common.loading')}</td>
              </tr>
            ) : pairs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400">{t('folderSync.noPairsHint')}</td>
              </tr>
            ) : (
              pairs.map((record) => {
                const prog = progress[record.id];
                const d = directionLabel[record.direction] || directionLabel.bidirectional;
                const last = lastResults[record.id];
                const isExpanded = expandedRows.has(record.id);

                return (
                  <React.Fragment key={record.id}>
                    <tr className="border-b border-border hover:bg-gray-50">
                      <td className="p-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 truncate max-w-xs">
                              <FolderOpen size={16} />
                              <span className="truncate">{record.localPath}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{record.localPath}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="p-3">
                        <Badge variant={d.color === 'blue' ? 'default' : d.color === 'green' ? 'success' : 'warning'}>
                          <span className="flex items-center gap-1">
                            {d.icon}
                            {d.text}
                          </span>
                        </Badge>
                      </td>
                      <td className="p-3 truncate max-w-xs">{record.remotePath}</td>
                      <td className="p-3">
                        {record.lastSynced ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-gray-600">{formatRelativeTime(record.lastSynced)}</span>
                            </TooltipTrigger>
                            <TooltipContent>{formatDate(record.lastSynced)}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-gray-400">{t('common.never')}</span>
                        )}
                      </td>
                      <td className="p-3">
                        {syncing.has(record.id) && prog?.current != null && prog?.total != null ? (
                          <div className="space-y-1">
                            <Progress value={Math.round((prog.current / prog.total) * 100)} />
                            {prog.file && (
                              <div className="text-xs text-gray-500 truncate">
                                {prog.action && <Badge variant="info" className="text-xs mr-1">{prog.action}</Badge>}
                                {prog.file}
                                {prog.bytes != null && prog.bytes > 0 && ` (${formatBytes(prog.bytes)})`}
                              </div>
                            )}
                          </div>
                        ) : syncing.has(record.id) ? (
                          <Badge variant="info">
                            <RefreshCw size={12} className="animate-spin mr-1" />
                            {t('folderSync.syncing')}
                          </Badge>
                        ) : last ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="success">
                                {t('folderSync.itemsSynced', { count: last.pushed + last.pulled + last.deleted_local + last.deleted_remote })}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatBytes(last.bytes_pushed + last.bytes_pulled)} @ {last.speed_mbps.toFixed(1)} MB/s, {formatDurationMs(last.duration_ms)}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge>{t('common.ready')}</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" loading={syncing.has(record.id)} onClick={() => handleSync(record.id)}>
                                <Play size={16} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('folderSync.syncNow')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => openIgnoreEditor(record.localPath)}>
                                <FileText size={16} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('folderSync.ignoreRules')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => { setCleanupPath(record.localPath); setCleanupVisible(true); }}>
                                <Eraser size={16} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('folderSync.cleanVersions')}</TooltipContent>
                          </Tooltip>
                          <Button variant="ghost" size="sm" onClick={() => handleRemove(record.id)}>
                            <Trash2 size={16} className="text-red-500" />
                          </Button>
                          {last && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedRows((prev) => {
                                const next = new Set(prev);
                                if (next.has(record.id)) next.delete(record.id);
                                else next.add(record.id);
                                return next;
                              })}
                            >
                              {isExpanded ? '▲' : '▼'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && last && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="p-4">
                          <div className="grid grid-cols-8 gap-4">
                            <div><div className="text-gray-500 text-xs">{t('folderSync.pushed')}</div><div className="text-sm font-semibold">{last.pushed}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.pulled')}</div><div className="text-sm font-semibold">{last.pulled}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.localDeleted')}</div><div className="text-sm font-semibold">{last.deleted_local}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.remoteDeleted')}</div><div className="text-sm font-semibold">{last.deleted_remote}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.conflicts')}</div><div className="text-sm font-semibold">{last.conflicts}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.pushVolume')}</div><div className="text-sm font-semibold">{formatBytes(last.bytes_pushed)}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.pullVolume')}</div><div className="text-sm font-semibold">{formatBytes(last.bytes_pulled)}</div></div>
                            <div><div className="text-gray-500 text-xs">{t('folderSync.speed')}</div><div className="text-sm font-semibold">{last.speed_mbps.toFixed(1)} MB/s</div></div>
                          </div>
                          {last.errors.length > 0 && (
                            <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-red-50 border border-red-200 text-sm mt-3">
                              <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <div className="font-semibold text-red-700">{t('folderSync.errorsCount', { count: last.errors.length })}</div>
                                <div className="text-red-600 whitespace-pre-line mt-1">{last.errors.join('\n')}</div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>

        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)] mt-[var(--card-gap)]">
          <details>
            <summary className="cursor-pointer font-semibold text-[var(--font-size-base)] flex items-center gap-2">
              <Info size={16} />
              {t('folderSync.synthing.title')}
            </summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mt-3 text-[var(--font-size-sm)]">
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.transport')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.transportDesc')}</dd>
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.ignore')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.ignoreDesc')}</dd>
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.versioning')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.versioningDesc')}</dd>
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.conflict')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.conflictDesc')}</dd>
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.incremental')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.incrementalDesc')}</dd>
              <dt className="text-gray-600 font-medium">{t('folderSync.synthing.largeFile')}</dt>
              <dd className="text-gray-800">{t('folderSync.synthing.largeFileDesc')}</dd>
            </dl>
          </details>
        </div>
      </div>

      <Dialog open={addVisible} onOpenChange={setAddVisible}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('folderSync.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('folderSync.localPath')}</div>
              <div className="flex gap-2">
                <Input
                  value={newPair.localPath}
                  onChange={(e) => setNewPair((p) => ({ ...p, localPath: e.target.value }))}
                  placeholder="/path/to/local/folder"
                  className="flex-1"
                />
                <Button onClick={selectLocalPath}>{t('common.browse')}</Button>
              </div>
            </div>
            <div>
              <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('folderSync.remotePath')}</div>
              <Input
                value={newPair.remotePath}
                onChange={(e) => setNewPair((p) => ({ ...p, remotePath: e.target.value }))}
                placeholder="/sdcard/folder"
              />
            </div>
            <div>
              <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('folderSync.direction')}</div>
              <Select value={newPair.direction} onValueChange={(v) => setNewPair((p) => ({ ...p, direction: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bidirectional">{t('folderSync.bidirectional')}</SelectItem>
                  <SelectItem value="push">{t('folderSync.pushToPhone')}</SelectItem>
                  <SelectItem value="pull">{t('folderSync.pullToPC')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('folderSync.conflictPolicy')}</div>
              <Select value={newPair.conflictPolicy} onValueChange={(v) => setNewPair((p) => ({ ...p, conflictPolicy: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conflictPolicies.map((policy) => (
                    <SelectItem key={policy.value} value={policy.value}>{policy.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-gray-500 mt-1">{t('folderSync.conflictHint')}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddVisible(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleAdd}>{t('common.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ignoreVisible} onOpenChange={setIgnoreVisible}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              <FileText size={16} className="inline mr-2" />
              {t('folderSync.editIgnoreRules')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-blue-50 border border-blue-200 text-sm">
            <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-blue-700 mb-1">{t('folderSync.ignoreRuleSyntax')}</div>
              <ul className="text-blue-600 pl-5 list-disc space-y-0.5 text-xs">
                <li>{t('folderSync.ignoreRule1')}</li>
                <li>{t('folderSync.ignoreRule2')}</li>
                <li>{t('folderSync.ignoreRule3')}</li>
                <li>{t('folderSync.ignoreRule4')}</li>
              </ul>
            </div>
          </div>
          <div className="text-xs text-gray-500 mb-2">
            {t('common.path')}: {ignoreLocalPath}/.droidlinkignore
          </div>
          <Textarea
            value={ignoreContent}
            onChange={(e) => setIgnoreContent(e.target.value)}
            rows={14}
            className="font-mono text-xs"
            placeholder="*.tmp&#10;node_modules/&#10;.git/&#10;!important.txt"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreVisible(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveIgnoreFile}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cleanupVisible} onOpenChange={setCleanupVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Eraser size={16} className="inline mr-2" />
              {t('folderSync.cleanVersionsTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-blue-50 border border-blue-200 text-sm mb-4">
            <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-blue-700">{t('folderSync.versionExplain')}</div>
          </div>
          <div className="text-sm text-gray-500 mb-3">
            {t('folderSync.syncPairPath', { path: cleanupPath })}
          </div>
          <div>
            <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('folderSync.retentionDays')}</div>
            <Input
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value) || 30)}
            />
            <div className="text-xs text-gray-500 mt-1">
              {t('folderSync.retentionHint', { days: retentionDays })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupVisible(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleCleanVersions} loading={cleaningUp}>{t('common.clean')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
