import React, { useEffect, useState } from 'react';
import {
  History, Undo2, Trash2, Eye, ArrowLeftRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { formatDate, safeJsonParse } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { VersionDiffView } from '../components/VersionDiffView';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Badge } from '../components/ui/badge';
import { cn } from '../utils/cn';

interface Version {
  id: string;
  createdAt: string;
  action: string;
  description: string;
  source: string;
  dataType: string;
  itemId?: string;
}

interface VersionDetail {
  record: {
    id: string;
    createdAt: string;
    action: string;
    description?: string;
    dataBefore?: string;
    dataAfter?: string;
    dataType: string;
    source: string;
  };
  snapshotData?: any;
}

interface CompareResult {
  versionA: {
    id: string;
    timestamp: string;
    action: string;
    description: string;
    dataType: string;
    data: any;
  };
  versionB: {
    id: string;
    timestamp: string;
    action: string;
    description: string;
    dataType: string;
    data: any;
  };
}

type DataType = 'contacts' | 'messages' | 'call_logs' | 'folders';

export const VersionHistory: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [versions, setVersions] = useState<Record<DataType, Version[]>>({
    contacts: [],
    messages: [],
    call_logs: [],
    folders: [],
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DataType>('contacts');
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [cleanupModalVisible, setCleanupModalVisible] = useState(false);
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(null);
  const [selectedDataType, setSelectedDataType] = useState<string>('contacts');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [beforeDate, setBeforeDate] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
    loadVersions(activeTab);
  }, [activeTab]);

  const loadVersions = async (dataType: DataType) => {
    setLoading(true);
    try {
      const data = await tauriInvoke<Version[]>('get_version_history', { dataType });
      setVersions((prev) => ({ ...prev, [dataType]: data || [] }));
    } catch (error) {
      console.error('Failed to load version history:', error);
      toast.error(t('versionHistory.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadVersionDetail = async (versionId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await tauriInvoke<VersionDetail>('get_version_detail', { versionId });
      setSelectedVersion(detail);
      setSelectedDataType(activeTab);
      setDetailModalVisible(true);
    } catch (error) {
      console.error('Failed to load version detail:', error);
      toast.error(t('versionHistory.loadDetailFailed'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRestore = (versionId: string, description: string) => {
    confirm({
      title: t('versionHistory.restoreConfirmTitle'),
      content: (
        <div>
          <p>{t('versionHistory.restoreConfirm', { description })}</p>
          <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)] mt-2">
            <span className="text-emerald-800">{t('versionHistory.restoreNote')}</span>
          </div>
        </div>
      ),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          toast.success(t('versionHistory.restored'));
          loadVersions(activeTab);
        } catch (error) {
          toast.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const handleCompareToggle = (versionId: string, checked: boolean) => {
    setSelectedForCompare((prev) => {
      if (checked) {
        if (prev.length >= 2) {
          return [prev[1], versionId];
        }
        return [...prev, versionId];
      }
      return prev.filter((id) => id !== versionId);
    });
  };

  const handleCompare = async () => {
    if (selectedForCompare.length !== 2) {
      toast.warning(t('versionHistory.selectTwoVersions'));
      return;
    }
    setLoadingCompare(true);
    try {
      const result = await tauriInvoke<CompareResult>('compare_versions', {
        versionIdA: selectedForCompare[0],
        versionIdB: selectedForCompare[1],
      });
      setCompareResult(result);
      setCompareModalVisible(true);
    } catch (error) {
      console.error('Failed to compare versions:', error);
      toast.error(t('versionHistory.compareFailed'));
    } finally {
      setLoadingCompare(false);
    }
  };

  const handleCleanup = async () => {
    if (!beforeDate) {
      toast.warning(t('versionHistory.selectDate'));
      return;
    }
    setCleaning(true);
    try {
      const count = await tauriInvoke<number>('delete_old_versions', {
        beforeDate: new Date(beforeDate).toISOString(),
      });
      toast.success(t('versionHistory.cleaned', { count }));
      setCleanupModalVisible(false);
      setBeforeDate('');
      loadVersions(activeTab);
    } catch (error) {
      toast.error(t('versionHistory.cleanFailed'));
    } finally {
      setCleaning(false);
    }
  };

  const getActionColor = (action: string) => {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('create') || actionLower.includes('add') || actionLower.includes('新增') || actionLower.includes('创建')) return 'success';
    if (actionLower.includes('update') || actionLower.includes('modify') || actionLower.includes('修改') || actionLower.includes('更新')) return 'info';
    if (actionLower.includes('delete') || actionLower.includes('remove') || actionLower.includes('删除')) return 'error';
    if (actionLower.includes('restore') || actionLower.includes('恢复')) return 'warning';
    return 'default';
  };

  const renderTimeline = (versionList: Version[]) => {
    if (versionList.length === 0) {
      return <div className="text-center py-12 text-gray-400">{t('versionHistory.noVersions')}</div>;
    }

    return (
      <div className="flex flex-col gap-3">
        {versionList.map((version) => (
          <div key={version.id} className="flex gap-4">
            <div className="text-[var(--font-size-xs)] text-gray-500 w-32 text-right pt-1">
              {formatDate(version.createdAt)}
            </div>
            <div className="relative flex-1">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />
              <div
                className={cn(
                  "absolute left-0 top-2 w-2 h-2 rounded-full -translate-x-[3.5px]",
                  getActionColor(version.action) === 'success' && "bg-green-500",
                  getActionColor(version.action) === 'info' && "bg-emerald-500",
                  getActionColor(version.action) === 'error' && "bg-red-500",
                  getActionColor(version.action) === 'warning' && "bg-yellow-500",
                  getActionColor(version.action) === 'default' && "bg-gray-400"
                )}
              />
              <div className="ml-6 rounded-[var(--border-radius)] border border-border bg-white p-3">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    {compareMode && (
                      <input
                        type="checkbox"
                        checked={selectedForCompare.includes(version.id)}
                        onChange={(e) => handleCompareToggle(version.id, e.target.checked)}
                        className="w-4 h-4"
                      />
                    )}
                    <Badge variant={getActionColor(version.action)}>
                      {version.action}
                    </Badge>
                    <span className="font-semibold">{version.description}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadVersionDetail(version.id)}
                    >
                      <Eye size={14} />
                      {t('versionHistory.viewDetail')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(version.id, version.description)}
                    >
                      <Undo2 size={14} />
                      {t('versionHistory.restore')}
                    </Button>
                  </div>
                </div>
                <div className="text-[var(--font-size-xs)] text-gray-500">
                  {t('versionHistory.sourcePrefix', { source: version.source })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDetailModal = () => {
    if (!selectedVersion) return null;

    const rec = selectedVersion?.record;
    if (!rec) return null;
    const beforeData = safeJsonParse(rec.dataBefore);
    const afterData = safeJsonParse(rec.dataAfter);

    return (
      <Dialog open={detailModalVisible} onOpenChange={setDetailModalVisible}>
        <DialogContent className="max-w-[800px]">
          <DialogHeader>
            <DialogTitle>{t('versionHistory.detail')}</DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border border-border rounded-[var(--border-radius)] p-3 text-[var(--font-size-sm)]">
                <dt className="text-gray-500 font-medium">{t('versionHistory.operation')}</dt>
                <dd><Badge variant={getActionColor(rec.action)}>{rec.action}</Badge></dd>
                <dt className="text-gray-500 font-medium">{t('versionHistory.description')}</dt>
                <dd>{rec.description}</dd>
                <dt className="text-gray-500 font-medium">{t('versionHistory.time')}</dt>
                <dd>{formatDate(rec.createdAt)}</dd>
              </dl>

              {beforeData && (
                <>
                  <div className="font-semibold text-[var(--font-size-sm)] border-t border-border pt-3">{t('versionHistory.before')}</div>
                  <VersionPreview dataType={selectedDataType} data={beforeData} />
                </>
              )}

              {afterData && (
                <>
                  <div className="font-semibold text-[var(--font-size-sm)] border-t border-border pt-3">{t('versionHistory.after')}</div>
                  <VersionPreview dataType={selectedDataType} data={afterData} />
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalVisible(false)}>
              {t('common.close')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (selectedVersion) {
                  handleRestore(selectedVersion.record.id, selectedVersion.record.description || '');
                  setDetailModalVisible(false);
                }
              }}
            >
              <Undo2 size={16} />
              {t('versionHistory.restoreAsNew')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  const renderCompareModal = () => {
    if (!compareResult) return null;

    return (
      <Dialog open={compareModalVisible} onOpenChange={setCompareModalVisible}>
        <DialogContent className="max-w-[900px]">
          <DialogHeader>
            <DialogTitle>{t('versionHistory.compareVersions')}</DialogTitle>
          </DialogHeader>
          <VersionDiffView
            dataType={compareResult.versionA.dataType}
            versionA={compareResult.versionA.data}
            versionB={compareResult.versionB.data}
            timestampA={compareResult.versionA.timestamp}
            timestampB={compareResult.versionB.timestamp}
            actionA={compareResult.versionA.action}
            actionB={compareResult.versionB.action}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompareModalVisible(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  const renderCleanupModal = () => (
    <Dialog open={cleanupModalVisible} onOpenChange={setCleanupModalVisible}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('versionHistory.deleteOld')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="text-[var(--font-size-sm)] text-gray-600">{t('versionHistory.cleanupDesc')}</div>
          <div>
            <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('versionHistory.selectDateLabel')}</div>
            <input
              type="date"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
              className="w-full p-2 border border-border rounded-[var(--border-radius)]"
            />
          </div>
          <div className="text-[var(--font-size-sm)] text-yellow-600 font-medium">
            {t('versionHistory.cleanupWarning')}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCleanupModalVisible(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleCleanup} loading={cleaning}>
            {t('common.clean')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const tabItems = [
    { key: 'contacts', label: t('versionHistory.contacts') },
    { key: 'messages', label: t('versionHistory.messages') },
    { key: 'call_logs', label: t('versionHistory.callLogs') },
    { key: 'folders', label: t('versionHistory.folderSync') },
  ];

  return (
    <div style={{ padding: 'var(--page-padding)' }}>
      <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <h2 className="text-[var(--font-size-title)] font-semibold flex items-center gap-2">
              <History size={20} />
              {t('versionHistory.title')}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={compareMode ? 'primary' : 'outline'}
                onClick={() => {
                  setCompareMode(!compareMode);
                  setSelectedForCompare([]);
                }}
              >
                <ArrowLeftRight size={16} />
                {t('versionHistory.compare')}
              </Button>
              {compareMode && selectedForCompare.length === 2 && (
                <Button
                  variant="primary"
                  loading={loadingCompare}
                  onClick={handleCompare}
                >
                  <ArrowLeftRight size={16} />
                  {t('versionHistory.compareVersions')}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => setCleanupModalVisible(true)}
              >
                <Trash2 size={16} />
                {t('versionHistory.deleteOld')}
              </Button>
            </div>
          </div>

          {compareMode && (
            <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)]">
              <span className="text-emerald-800">
                {t('versionHistory.selectTwoVersions')}
                {selectedForCompare.length > 0 && ` - ${selectedForCompare.length}/2 ${t('versionHistory.selected')}`}
              </span>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => {
          setActiveTab(v as DataType);
          setSelectedForCompare([]);
        }}>
          <TabsList>
            {tabItems.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabItems.map((item) => (
            <TabsContent key={item.key} value={item.key}>
              {loading ? (
                <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
              ) : (
                <div className="py-6">
                  {renderTimeline(versions[item.key as DataType])}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {renderDetailModal()}
      {renderCompareModal()}
      {renderCleanupModal()}
    </div>
  );
};
