import { useState, useEffect } from 'react';
import {
  Copy, Send, Upload, Download, File, Folder, ArrowLeftRight, Info,
  CheckCircle2, Usb,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatFileSize } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogBody } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { Badge } from '../components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { cn } from '../utils/cn';

interface ClipboardResult {
  text?: string;
  method: string;
  length: number;
  byteSize: number;
}

interface ClipboardInfo {
  maxSize: number;
  method: string;
  companionInstalled: boolean;
}

export default function Transfer() {
  const { t } = useTranslation();
  const toast = useToast();
  const device = useStore((s) => s.connectedDevice);
  const [clipText, setClipText] = useState('');
  const [deviceClipText, setDeviceClipText] = useState('');
  const [clipInfo, setClipInfo] = useState<ClipboardInfo | null>(null);
  const [lastSendResult, setLastSendResult] = useState<ClipboardResult | null>(null);
  const [lastReceiveResult, setLastReceiveResult] = useState<ClipboardResult | null>(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [fileSending, setFileSending] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveDevicePath, setReceiveDevicePath] = useState('/sdcard/');
  const [transferHistory, setTransferHistory] = useState<Array<{
    type: string; name: string; time: string; direction: string; method?: string; size?: string;
  }>>([]);

  const methodLabels: Record<string, string> = {
    broadcast: t('transfer.broadcast'),
    file_transfer: t('transfer.fileRelay'),
  };

  useEffect(() => {
    if (device) {
      tauriInvoke<ClipboardInfo>('get_clipboard_info', { serial: device.serial })
        .then(setClipInfo)
        .catch(console.error);
    }
  }, [device]);

  if (!device) {
    return (
      <>
        <div className="page-header"><h2>{t('transfer.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <div className="text-center py-12 text-gray-400">{t('common.connectDevice')}</div>
        </div>
      </>
    );
  }

  const textByteSize = new TextEncoder().encode(clipText).length;
  const textCharCount = clipText.length;
  const maxSize = clipInfo?.maxSize || 10 * 1024 * 1024;
  const isOverLimit = textByteSize > maxSize;

  const handleSendToDevice = async () => {
    if (!clipText.trim()) {
      toast.warning(t('transfer.enterContent'));
      return;
    }
    if (isOverLimit) {
      toast.error(t('transfer.contentTooLarge', { size: formatFileSize(textByteSize), max: formatFileSize(maxSize) }));
      return;
    }
    setSending(true);
    try {
      const result = await tauriInvoke<ClipboardResult>('send_clipboard_to_device', {
        serial: device.serial, content: clipText,
      });
      setLastSendResult(result);
      toast.success(t('transfer.sentToDevice', { method: methodLabels[result.method] || result.method }));
      setTransferHistory((prev) => [{
        type: 'clipboard', name: `${textCharCount} ${t('common.chars')}`, time: new Date().toLocaleTimeString(),
        direction: 'send', method: result.method, size: formatFileSize(textByteSize),
      }, ...prev]);
    } catch (err: any) {
      toast.error(t('transfer.sendFailed', { error: err }));
    } finally {
      setSending(false);
    }
  };

  const handleReceiveFromDevice = async () => {
    setReceiving(true);
    try {
      const result = await tauriInvoke<ClipboardResult>('get_clipboard_content', {
        serial: device.serial,
      });
      const text = result.text ?? '';
      setDeviceClipText(text);
      setLastReceiveResult(result);
      if (text === '') {
        toast.info(t('transfer.clipboardEmpty'));
      } else {
        toast.success(t('transfer.gotClipboard', { length: result.length, method: methodLabels[result.method] || result.method }));
        setTransferHistory((prev) => [{
          type: 'clipboard', name: `${result.length} ${t('common.chars')}`, time: new Date().toLocaleTimeString(),
          direction: 'receive', method: result.method, size: formatFileSize(result.byteSize),
        }, ...prev]);
      }
    } catch (err: any) {
      const errorMsg = String(err);
      if (errorMsg.includes('CLIPBOARD_ACCESS_DENIED')) {
        toast.error(t('transfer.clipboardAccessDenied'));
      } else if (errorMsg.includes('CLIPBOARD_READ_ERROR')) {
        toast.error(t('transfer.clipboardReadError'));
      } else {
        toast.error(t('transfer.getFailed', { error: err }));
      }
    } finally {
      setReceiving(false);
    }
  };

  const handleCopyToLocal = () => {
    if (deviceClipText) {
      navigator.clipboard.writeText(deviceClipText).then(() => {
        toast.success(t('transfer.copiedToPC'));
      });
    }
  };

  const handlePasteFromLocal = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setClipText(text);
    } catch {
      toast.warning(t('transfer.cannotReadClipboard'));
    }
  };

  const handleSendFile = async () => {
    try {
      const filePath = await open({ multiple: false, title: t('transfer.selectFile') });
      if (!filePath) return;
      setFileSending(true);
      const fileName = (filePath as string).split(/[/\\]/).pop() || 'file';
      const remotePath = `/sdcard/Download/${fileName}`;
      await tauriInvoke('send_file_to_device', { serial: device.serial, localPath: filePath as string, remotePath });
      toast.success(t('transfer.fileSent', { name: fileName }));
      setTransferHistory((prev) => [{
        type: 'file', name: fileName, time: new Date().toLocaleTimeString(), direction: 'send',
      }, ...prev]);
    } catch (err: any) {
      toast.error(t('transfer.sendFailed', { error: err }));
    } finally {
      setFileSending(false);
    }
  };

  const handleSendFolder = async () => {
    try {
      const folderPath = await open({ directory: true, title: t('transfer.selectFolder') });
      if (!folderPath) return;
      setFileSending(true);
      const folderName = (folderPath as string).split(/[/\\]/).pop() || 'folder';
      const remotePath = `/sdcard/Download/${folderName}`;
      await tauriInvoke('send_folder_to_device', { serial: device.serial, localPath: folderPath as string, remotePath });
      toast.success(t('transfer.folderSent', { name: folderName }));
      setTransferHistory((prev) => [{
        type: 'folder', name: folderName, time: new Date().toLocaleTimeString(), direction: 'send',
      }, ...prev]);
    } catch (err: any) {
      toast.error(t('transfer.sendFailed', { error: err }));
    } finally {
      setFileSending(false);
    }
  };

  const handleReceiveFile = () => {
    setReceiveDevicePath('/sdcard/');
    setReceiveDialogOpen(true);
  };

  const handleReceiveConfirm = async () => {
    if (!receiveDevicePath.trim()) return;
    setReceiveDialogOpen(false);
    try {
      const savePath = await open({ directory: true, title: t('transfer.selectSaveLocation') });
      if (!savePath) return;
      setFileSending(true);
      const fileName = receiveDevicePath.split('/').pop() || 'file';
      const localPath = `${savePath}/${fileName}`;
      await tauriInvoke('receive_file_from_device', { serial: device.serial, remotePath: receiveDevicePath, localPath });
      toast.success(t('transfer.fileReceived', { name: fileName }));
      setTransferHistory((prev) => [{
        type: 'file', name: fileName, time: new Date().toLocaleTimeString(), direction: 'receive',
      }, ...prev]);
    } catch (err: any) {
      toast.error(t('transfer.receiveFailed', { error: err }));
    } finally {
      setFileSending(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>{t('transfer.title')}</h2>
        {clipInfo && (
          <div className="flex items-center gap-2">
            <Badge variant="success">
              <Usb size={14} className="mr-1" />
              {t('transfer.pureUsb')}
            </Badge>
            {clipInfo.companionInstalled && (
              <Badge variant="info">{t('transfer.companionInstalled')}</Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-gray-500 hover:text-gray-700">
                  <Info size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('transfer.maxTransferInfo', { size: formatFileSize(clipInfo.maxSize) })}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="page-body">
        <Tabs defaultValue="clipboard">
          <TabsList>
            <TabsTrigger value="clipboard">
              <Copy size={16} className="mr-2" />
              {t('transfer.clipboard')}
            </TabsTrigger>
            <TabsTrigger value="files">
              <File size={16} className="mr-2" />
              {t('transfer.fileTransfer')}
            </TabsTrigger>
            <TabsTrigger value="history">
              <ArrowLeftRight size={16} className="mr-2" />
              {t('transfer.transferHistory')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clipboard">
            <div className="grid grid-cols-2 gap-4 max-w-[1000px]">
              <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-semibold text-[var(--font-size-base)] flex items-center gap-2">
                    <Send size={16} />
                    {t('transfer.pcToPhone')}
                  </div>
                  <Button size="sm" variant="outline" onClick={handlePasteFromLocal}>
                    {t('common.paste')}
                  </Button>
                </div>
                <Textarea
                  rows={10}
                  value={clipText}
                  onChange={(e) => setClipText(e.target.value)}
                  placeholder={t('transfer.inputPlaceholder')}
                  className="mb-3"
                />
                <div className="flex justify-between items-center mb-3">
                  <div className="flex gap-2">
                    <Badge>{textCharCount.toLocaleString()} {t('common.chars')}</Badge>
                    <Badge variant={isOverLimit ? 'error' : 'default'}>{formatFileSize(textByteSize)}</Badge>
                  </div>
                  {lastSendResult && (
                    <Badge variant="success">
                      <CheckCircle2 size={14} className="mr-1" />
                      {methodLabels[lastSendResult.method] || lastSendResult.method}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={handleSendToDevice}
                  loading={sending}
                  disabled={!clipText.trim() || isOverLimit}
                  block
                >
                  <Send size={16} />
                  {t('transfer.sendToDevice')}
                </Button>
              </div>

              <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-semibold text-[var(--font-size-base)] flex items-center gap-2">
                    <Download size={16} />
                    {t('transfer.phoneToPC')}
                  </div>
                  <Button size="sm" variant="outline" onClick={handleCopyToLocal} disabled={!deviceClipText}>
                    {t('common.copy')}
                  </Button>
                </div>
                <div
                  className={cn(
                    "min-h-[226px] max-h-[226px] overflow-auto p-3 bg-gray-50 rounded-md border border-border",
                    "whitespace-pre-wrap break-all text-sm mb-3",
                    !deviceClipText && "text-gray-400"
                  )}
                >
                  {deviceClipText || t('transfer.getDeviceClipboard')}
                </div>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex gap-2">
                    {deviceClipText && (
                      <>
                        <Badge>{deviceClipText.length.toLocaleString()} {t('common.chars')}</Badge>
                        <Badge>{formatFileSize(new TextEncoder().encode(deviceClipText).length)}</Badge>
                      </>
                    )}
                  </div>
                  {lastReceiveResult && (
                    <Badge variant="success">
                      <CheckCircle2 size={14} className="mr-1" />
                      {methodLabels[lastReceiveResult.method] || lastReceiveResult.method}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={handleReceiveFromDevice}
                  loading={receiving}
                  block
                >
                  <Download size={16} />
                  {t('transfer.getFromDevice')}
                </Button>
              </div>

              <div className="col-span-2">
                <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)]">
                  <Info size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="text-emerald-800">
                    <div className="font-semibold mb-1">{t('transfer.clipboardInfoTitle')}</div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      <li>{t('transfer.clipboardInfo1')}</li>
                      <li>{t('transfer.clipboardInfo2')}</li>
                      <li>{t('transfer.clipboardInfo3')}</li>
                      <li>{t('transfer.clipboardInfo4')}</li>
                      <li>{t('transfer.clipboardInfo5')}</li>
                      <li>{t('transfer.clipboardInfo6')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="files">
            <div className="max-w-[640px] flex flex-col gap-4">
              <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
                <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('transfer.pcToPhone')}</div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <Button onClick={handleSendFile} loading={fileSending}>
                    <Upload size={16} />
                    {t('transfer.sendFile')}
                  </Button>
                  <Button onClick={handleSendFolder} loading={fileSending}>
                    <Folder size={16} />
                    {t('transfer.sendFolder')}
                  </Button>
                </div>
                <div className="text-xs text-gray-500">
                  {t('transfer.pcToPhoneDesc')}
                </div>
              </div>

              <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
                <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('transfer.phoneToPC')}</div>
                <Button onClick={handleReceiveFile} loading={fileSending}>
                  <Download size={16} />
                  {t('transfer.receiveFile')}
                </Button>
                <div className="text-xs text-gray-500 mt-2">
                  {t('transfer.phoneToPCDesc')}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="max-w-[640px]">
              {transferHistory.length === 0 ? (
                <div className="text-center py-12 text-gray-400">{t('transfer.noHistory')}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {transferHistory.map((item, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 rounded-[var(--border-radius)] border border-border hover:bg-gray-50">
                      {item.type === 'clipboard' ? (
                        <Copy size={16} className="text-gray-500" />
                      ) : item.type === 'folder' ? (
                        <Folder size={16} className="text-gray-500" />
                      ) : (
                        <File size={16} className="text-gray-500" />
                      )}
                      <span className="flex-1">{item.name}</span>
                      <Badge variant={item.direction === 'send' ? 'info' : 'success'}>
                        {item.direction === 'send' ? t('transfer.directionSend') : t('transfer.directionReceive')}
                      </Badge>
                      {item.method && <Badge>{methodLabels[item.method] || item.method}</Badge>}
                      {item.size && <Badge variant="default">{item.size}</Badge>}
                      <span className="text-xs text-gray-500">{item.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
      {/* Device path input dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('transfer.enterDevicePath')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              value={receiveDevicePath}
              onChange={(e) => setReceiveDevicePath(e.target.value)}
              placeholder="/sdcard/filename.txt"
              onKeyDown={(e) => { if (e.key === 'Enter') handleReceiveConfirm(); }}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleReceiveConfirm}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
