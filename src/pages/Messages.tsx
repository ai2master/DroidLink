import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  User,
  History,
  Eye,
  Undo2,
  RotateCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatRelativeTime, safeJsonParse } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogBody } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Badge } from '../components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu';
import { cn } from '../utils/cn';

interface Conversation {
  threadId: string;
  address: string;
  contactName?: string;
  lastMessage: string;
  lastDate: string;
  messageCount: number;
}

interface Message {
  id: string;
  threadId: string;
  address: string;
  body: string;
  date: string;
  type: number; // 1=received, 2=sent
  read: boolean;
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

export const Messages: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice, companionInstalled, setShowCompanionPrompt } = useStore();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [exporting, setExporting] = useState(false);

  // Version history
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [versionHistory, setVersionHistory] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);

  const loadConversations = useCallback(async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<Conversation[]>('get_conversations', {
        serial: connectedDevice.serial,
      });
      setConversations(data || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      toast.error(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [connectedDevice, toast, t]);

  useEffect(() => {
    if (connectedDevice) {
      loadConversations();
    }
  }, [connectedDevice, loadConversations]);

  useEffect(() => {
    if (!searchText.trim()) {
      setFilteredConversations(conversations);
      return;
    }
    const text = searchText.toLowerCase();
    const filtered = conversations.filter(
      (conv) =>
        conv.address?.toLowerCase().includes(text) ||
        conv.contactName?.toLowerCase().includes(text) ||
        conv.lastMessage?.toLowerCase().includes(text)
    );
    setFilteredConversations(filtered);
  }, [searchText, conversations]);

  const loadMessages = async (threadId: string) => {
    if (!connectedDevice) return;
    setLoadingMessages(true);
    setSelectedThreadId(threadId);
    try {
      const data = await tauriInvoke<Message[]>('get_messages', {
        serial: connectedDevice.serial,
        threadId,
      });
      setMessages(data || []);
    } catch (error) {
      console.error('Failed to load messages:', error);
      toast.error(t('messages.loadMessagesFailed'));
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'messages',
      });
      toast.success(t('messages.syncStarted'));
      setTimeout(loadConversations, 2000);
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
      const path = await tauriInvoke<string>('export_messages', {
        serial: connectedDevice.serial,
        format,
        outputPath: `messages_export_${Date.now()}.${format}`,
      });
      toast.success(t('messages.exportSuccess', { path }));
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
        dataType: 'messages',
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
          loadConversations();
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

  const selectedConversation = conversations.find(
    (conv) => conv.threadId === selectedThreadId
  );

  if (!connectedDevice) {
    return (
      <div className="flex items-center justify-center" style={{ padding: '100px 20px' }}>
        <div className="text-center py-12 text-gray-400">
          <h3 className="text-[var(--font-size-lg)] font-semibold mb-2 text-gray-900">
            {t('common.connectDeviceTitle')}
          </h3>
          <p className="text-[var(--font-size-base)]">{t('messages.connectDeviceDesc')}</p>
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
            {t('messages.title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t('messages.searchPlaceholder')}
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
          </div>
        </div>

        <div className="flex bg-white min-h-[600px]">
          {/* Conversation list sidebar */}
          <div className="w-[350px] bg-gray-50 border-r border-border shrink-0">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <RotateCw className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div>
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.threadId}
                    onClick={() => loadMessages(conv.threadId)}
                    className={cn(
                      "cursor-pointer p-3 border-b border-border hover:bg-gray-100 transition-colors",
                      selectedThreadId === conv.threadId && "bg-emerald-50"
                    )}
                  >
                    <div className="flex gap-3 items-start">
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                        <User className="w-5 h-5 text-gray-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-[var(--font-size-base)] truncate">
                            {conv.contactName || conv.address}
                          </span>
                          <span className="text-gray-400 text-xs shrink-0 ml-2">
                            {formatRelativeTime(conv.lastDate)}
                          </span>
                        </div>
                        <p className="text-gray-500 text-[var(--font-size-sm)] truncate mb-1">
                          {conv.lastMessage}
                        </p>
                        <span className="text-gray-400 text-xs">
                          {t('messages.messageCount', { count: conv.messageCount })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredConversations.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    {searchText ? t('messages.noMatch') : t('messages.noData')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Message content area */}
          <div className="flex-1 p-4 bg-white">
            {selectedThreadId ? (
              loadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <RotateCw className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="p-3 border-b border-border mb-4">
                    <h4 className="text-[var(--font-size-base)] font-semibold m-0">
                      {selectedConversation?.contactName || selectedConversation?.address}
                    </h4>
                    {selectedConversation?.contactName && (
                      <p className="text-gray-400 text-[var(--font-size-sm)] mt-1">
                        {selectedConversation.address}
                      </p>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto px-4" style={{ maxHeight: '480px' }}>
                    {messages.length > 0 ? (
                      <div className="space-y-3">
                        {messages.map((msg) => {
                          const isSent = msg.type === 2;
                          return (
                            <div
                              key={msg.id}
                              className={cn("flex", isSent ? "justify-end" : "justify-start")}
                            >
                              <div
                                className={cn(
                                  "max-w-[70%] px-3 py-2 rounded-xl",
                                  isSent
                                    ? "bg-emerald-500 text-white"
                                    : "bg-gray-100 text-gray-900"
                                )}
                              >
                                <div className="break-words text-[var(--font-size-base)]">
                                  {msg.body}
                                </div>
                                <div
                                  className={cn(
                                    "mt-1 text-xs text-right",
                                    isSent ? "opacity-80" : "opacity-60"
                                  )}
                                >
                                  {formatDate(msg.date)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-400">
                        {t('messages.noMessages')}
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center py-12 text-gray-400">
                  {t('messages.selectConversation')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Version history modal */}
      <Dialog open={versionModalVisible} onOpenChange={setVersionModalVisible}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <History className="w-5 h-5" />
                {t('versionHistory.title')} - {t('versionHistory.messages')}
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
                              <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", getActionBadgeClass(color))}>
                                {v.action}
                              </span>
                              <span>{v.description}</span>
                              <span className="text-gray-400 text-xs">{formatDate(v.createdAt)}</span>
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
                      <VersionPreview dataType="messages" data={beforeData} />
                    </>
                  )}
                  {afterData && (
                    <>
                      <h5 className="text-[var(--font-size-base)] font-semibold mb-2 mt-4">{t('versionHistory.after')}</h5>
                      <VersionPreview dataType="messages" data={afterData} />
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
