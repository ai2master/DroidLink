import React, { useEffect, useState } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  RotateCw,
  Trash2,
  History,
  Undo2,
  Eye,
  ArrowLeftRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, safeJsonParse } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { VersionDiffView } from '../components/VersionDiffView';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogBody } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu';
import { cn } from '../utils/cn';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  note?: string;
  lastModified?: string;
}

interface Version {
  id: string;
  createdAt: string;
  action: string;
  changes: string;
  dataBefore?: string;
  dataAfter?: string;
}

export const Contacts: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice, companionInstalled, setShowCompanionPrompt } = useStore();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [exporting, setExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Version detail modal
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);

  // Version compare modal
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);

  useEffect(() => {
    if (connectedDevice) {
      loadContacts();
    }
  }, [connectedDevice]);

  useEffect(() => {
    filterContacts();
  }, [searchText, contacts]);

  const loadContacts = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<Contact[]>('get_contacts', {
        serial: connectedDevice.serial,
      });
      setContacts(data || []);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      toast.error(t('contacts.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filterContacts = () => {
    if (!searchText.trim()) {
      setFilteredContacts(contacts);
      return;
    }
    const text = searchText.toLowerCase();
    const filtered = contacts.filter(
      (contact) =>
        contact.name?.toLowerCase().includes(text) ||
        contact.phone?.toLowerCase().includes(text) ||
        contact.email?.toLowerCase().includes(text) ||
        contact.company?.toLowerCase().includes(text)
    );
    setFilteredContacts(filtered);
  };

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'contacts',
      });
      toast.success(t('contacts.syncStarted'));
      setTimeout(loadContacts, 2000);
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
      const path = await tauriInvoke<string>('export_contacts', {
        serial: connectedDevice.serial,
        format,
        outputPath: `contacts_export_${Date.now()}.${format}`,
      });
      toast.success(t('contacts.exportSuccess', { path }));
    } catch (error) {
      toast.error(t('common.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (contact: Contact) => {
    confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('contacts.deleteConfirm', { name: contact.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      onOk: async () => {
        try {
          toast.success(t('contacts.deleted'));
          loadContacts();
        } catch (error) {
          toast.error(t('common.deleteFailed'));
        }
      },
    });
  };

  const loadVersionHistory = async (contactId: string) => {
    try {
      const history = await tauriInvoke<Version[]>('get_version_history', {
        dataType: 'contacts',
        itemId: contactId,
      });
      setVersions((prev) => ({ ...prev, [contactId]: history || [] }));
    } catch (error) {
      console.error('Failed to load version history:', error);
      toast.error(t('common.loadFailed'));
    }
  };

  const handleExpand = (contactId: string) => {
    const isExpanded = expandedRowKeys.includes(contactId);
    if (isExpanded) {
      setExpandedRowKeys(expandedRowKeys.filter((key) => key !== contactId));
    } else {
      setExpandedRowKeys([...expandedRowKeys, contactId]);
      loadVersionHistory(contactId);
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
      content: (
        <div>
          <p>{t('versionHistory.restoreConfirm', { description })}</p>
          <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            <span className="mr-2">ℹ</span>
            {t('versionHistory.restoreNote')}
          </div>
        </div>
      ),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          toast.success(t('versionHistory.restored'));
          loadContacts();
        } catch (error) {
          toast.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const handleCompareWithPrevious = async (contactVersions: Version[], index: number) => {
    if (index + 1 >= contactVersions.length) {
      toast.info(t('versionHistory.noPreviousVersion'));
      return;
    }
    try {
      const result = await tauriInvoke<any>('compare_versions', {
        versionIdA: contactVersions[index + 1].id,
        versionIdB: contactVersions[index].id,
      });
      setCompareResult(result);
      setCompareModalVisible(true);
    } catch (error) {
      toast.error(t('versionHistory.compareFailed'));
    }
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add') || a.includes('新增') || a.includes('创建')) return 'success';
    if (a.includes('update') || a.includes('modify') || a.includes('修改') || a.includes('更新')) return 'warning';
    if (a.includes('delete') || a.includes('remove') || a.includes('删除')) return 'error';
    if (a.includes('restore') || a.includes('恢复')) return 'warning';
    return 'default';
  };

  const getActionBadgeClass = (color: string) => {
    switch (color) {
      case 'success':
        return 'bg-green-50 text-green-700';
      case 'warning':
        return 'bg-blue-50 text-blue-700';
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
        return 'bg-blue-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const paginatedContacts = filteredContacts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const totalPages = Math.ceil(filteredContacts.length / pageSize);

  if (!connectedDevice) {
    return (
      <div className="flex items-center justify-center" style={{ padding: '100px 20px' }}>
        <div className="text-center py-12 text-gray-400">
          <h3 className="text-[var(--font-size-lg)] font-semibold mb-2 text-gray-900">
            {t('common.connectDeviceTitle')}
          </h3>
          <p className="text-[var(--font-size-base)]">{t('contacts.connectDeviceDesc')}</p>
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
            {t('contacts.title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t('contacts.searchPlaceholder')}
              icon={Search}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-[300px]"
            />
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
                <DropdownMenuItem onClick={() => handleExport('vcf')}>
                  {t('common.vcfFormat')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" loading={syncing} onClick={handleSync}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('common.sync')}
            </Button>
            <Button variant="outline" onClick={loadContacts}>
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
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('contacts.name')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('contacts.phone')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('contacts.email')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)]">
                      {t('contacts.organization')}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-[var(--font-size-sm)] w-[100px]">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedContacts.map((contact) => (
                    <React.Fragment key={contact.id}>
                      <tr className="border-b border-border hover:bg-gray-50">
                        <td className="px-3 py-2 truncate max-w-[200px]">{contact.name}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]">
                          <span className="font-mono">{contact.phone}</span>
                        </td>
                        <td className="px-3 py-2 truncate max-w-[200px]">
                          {contact.email || <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-3 py-2 truncate max-w-[200px]">
                          {contact.company || <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() => handleExpand(contact.id)}
                              >
                                {t('contacts.detail')}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('contacts.expandTooltip')}</TooltipContent>
                          </Tooltip>
                        </td>
                      </tr>
                      {expandedRowKeys.includes(contact.id) && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <div className="p-4 bg-gray-50">
                              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mb-4 p-3 border border-border rounded-md bg-white text-[var(--font-size-sm)]">
                                <dt className="font-medium text-gray-500">{t('contacts.name')}</dt>
                                <dd className="text-gray-900">{contact.name}</dd>
                                <dt className="font-medium text-gray-500">{t('contacts.phone')}</dt>
                                <dd className="text-gray-900">{contact.phone}</dd>
                                {contact.email && (
                                  <>
                                    <dt className="font-medium text-gray-500">{t('contacts.email')}</dt>
                                    <dd className="text-gray-900">{contact.email}</dd>
                                  </>
                                )}
                                {contact.company && (
                                  <>
                                    <dt className="font-medium text-gray-500">{t('contacts.organization')}</dt>
                                    <dd className="text-gray-900">{contact.company}</dd>
                                  </>
                                )}
                                {contact.note && (
                                  <>
                                    <dt className="font-medium text-gray-500">{t('contacts.note')}</dt>
                                    <dd className="text-gray-900 col-span-1">{contact.note}</dd>
                                  </>
                                )}
                                {contact.lastModified && (
                                  <>
                                    <dt className="font-medium text-gray-500">{t('contacts.lastModified')}</dt>
                                    <dd className="text-gray-900">{formatDate(contact.lastModified)}</dd>
                                  </>
                                )}
                              </dl>

                              {versions[contact.id] && versions[contact.id].length > 0 && (
                                <div>
                                  <h5 className="text-[var(--font-size-base)] font-semibold mb-3 flex items-center gap-2">
                                    <History className="w-4 h-4" />
                                    {t('contacts.versionHistory')}
                                  </h5>
                                  <div className="space-y-3">
                                    {versions[contact.id].map((version, index) => {
                                      const color = getActionColor(version.action);
                                      return (
                                        <div key={version.id} className="flex gap-3">
                                          <div className={cn("w-2 h-2 mt-2 rounded-full shrink-0", getActionDotClass(color))} />
                                          <div className="flex-1">
                                            <div className="rounded-[var(--border-radius)] border border-border bg-white p-3 text-[var(--font-size-sm)]">
                                              <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", getActionBadgeClass(color))}>
                                                    {version.action}
                                                  </span>
                                                  <span>{version.changes}</span>
                                                  <span className="text-gray-400 text-xs">
                                                    {formatDate(version.createdAt)}
                                                  </span>
                                                </div>
                                                <div className="flex gap-1">
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleViewVersionDetail(version.id)}
                                                      >
                                                        <Eye className="w-4 h-4" />
                                                      </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>{t('versionHistory.viewDetail')}</TooltipContent>
                                                  </Tooltip>
                                                  {index + 1 < versions[contact.id].length && (
                                                    <Tooltip>
                                                      <TooltipTrigger asChild>
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          onClick={() => handleCompareWithPrevious(versions[contact.id], index)}
                                                        >
                                                          <ArrowLeftRight className="w-4 h-4" />
                                                        </Button>
                                                      </TooltipTrigger>
                                                      <TooltipContent>{t('versionHistory.compareWith')}</TooltipContent>
                                                    </Tooltip>
                                                  )}
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleRestoreVersion(version.id, version.changes)}
                                                      >
                                                        <Undo2 className="w-4 h-4" />
                                                      </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>{t('versionHistory.restoreAsNew')}</TooltipContent>
                                                  </Tooltip>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="mt-4">
                                <Button
                                  variant="destructive"
                                  onClick={() => handleDelete(contact)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  {t('contacts.deleteContact')}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredContacts.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                {searchText ? t('contacts.noMatch') : t('contacts.noData')}
              </div>
            )}

            {filteredContacts.length > 0 && (
              <div className="mt-4 flex items-center justify-between text-[var(--font-size-sm)]">
                <div className="text-gray-500">
                  {t('common.totalRecords', { total: filteredContacts.length })}
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
              const color = getActionColor(record.action);
              return (
                <>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mb-4 p-3 border border-border rounded-md text-[var(--font-size-sm)]">
                    <dt className="font-medium text-gray-500">{t('versionHistory.operation')}</dt>
                    <dd>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", getActionBadgeClass(color))}>
                        {record.action}
                      </span>
                    </dd>
                    <dt className="font-medium text-gray-500">{t('versionHistory.description')}</dt>
                    <dd className="text-gray-900">{record.description}</dd>
                    <dt className="font-medium text-gray-500">{t('versionHistory.time')}</dt>
                    <dd className="text-gray-900">{formatDate(record.createdAt)}</dd>
                  </dl>
                  {beforeData && (
                    <>
                      <h5 className="text-[var(--font-size-base)] font-semibold mb-2">{t('versionHistory.before')}</h5>
                      <VersionPreview dataType="contacts" data={beforeData} />
                    </>
                  )}
                  {afterData && (
                    <>
                      <h5 className="text-[var(--font-size-base)] font-semibold mb-2 mt-4">{t('versionHistory.after')}</h5>
                      <VersionPreview dataType="contacts" data={afterData} />
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
            {selectedVersionDetail && (
              <Button
                variant="primary"
                onClick={() => {
                  handleRestoreVersion(
                    selectedVersionDetail.record?.id || selectedVersionDetail.id,
                    selectedVersionDetail.record?.description || ''
                  );
                  setDetailModalVisible(false);
                  setSelectedVersionDetail(null);
                }}
              >
                <Undo2 className="w-4 h-4 mr-2" />
                {t('versionHistory.restoreAsNew')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version compare modal */}
      <Dialog open={compareModalVisible} onOpenChange={setCompareModalVisible}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('versionHistory.compareVersions')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {compareResult && (
              <VersionDiffView
                dataType={compareResult.versionA.dataType}
                versionA={compareResult.versionA.data}
                versionB={compareResult.versionB.data}
                timestampA={compareResult.versionA.timestamp}
                timestampB={compareResult.versionB.timestamp}
                actionA={compareResult.versionA.action}
                actionB={compareResult.versionB.action}
              />
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCompareModalVisible(false);
                setCompareResult(null);
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
