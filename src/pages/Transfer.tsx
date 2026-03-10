import { useState, useEffect } from 'react';
import { Button, Card, Space, Input, Tabs, message, Empty, Tag, List, Alert, Tooltip } from 'antd';
import {
  CopyOutlined, SendOutlined, UploadOutlined, DownloadOutlined,
  FileOutlined, FolderOutlined, SwapOutlined, InfoCircleOutlined,
  CheckCircleOutlined, UsbOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatFileSize } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';

const { TextArea } = Input;

interface ClipboardResult {
  text?: string;
  method: string;
  length: number;
  byteSize: number;
}

interface ClipboardInfo {
  max_size: number;
  method: string;
  companion_installed: boolean;
}

export default function Transfer() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const [clipText, setClipText] = useState('');
  const [deviceClipText, setDeviceClipText] = useState('');
  const [clipInfo, setClipInfo] = useState<ClipboardInfo | null>(null);
  const [lastSendResult, setLastSendResult] = useState<ClipboardResult | null>(null);
  const [lastReceiveResult, setLastReceiveResult] = useState<ClipboardResult | null>(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [fileSending, setFileSending] = useState(false);
  const [transferHistory, setTransferHistory] = useState<Array<{
    type: string; name: string; time: string; direction: string; method?: string; size?: string;
  }>>([]);

  // 传输方式标签 / Method labels
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
          <Empty description={t('common.connectDevice')} />
        </div>
      </>
    );
  }

  const textByteSize = new TextEncoder().encode(clipText).length;
  const textCharCount = clipText.length;
  const maxSize = clipInfo?.max_size || 10 * 1024 * 1024;
  const isOverLimit = textByteSize > maxSize;

  // === 剪贴板: 电脑 -> 手机 / Clipboard: Desktop -> Device ===
  const handleSendToDevice = async () => {
    if (!clipText.trim()) {
      message.warning(t('transfer.enterContent'));
      return;
    }
    if (isOverLimit) {
      message.error(t('transfer.contentTooLarge', { size: formatFileSize(textByteSize), max: formatFileSize(maxSize) }));
      return;
    }
    setSending(true);
    try {
      const result = await tauriInvoke<ClipboardResult>('send_clipboard_to_device', {
        serial: device.serial, content: clipText,
      });
      setLastSendResult(result);
      message.success(t('transfer.sentToDevice', { method: methodLabels[result.method] || result.method }));
      setTransferHistory((prev) => [{
        type: 'clipboard', name: `${textCharCount} ${t('common.chars')}`, time: new Date().toLocaleTimeString(),
        direction: 'send', method: result.method, size: formatFileSize(textByteSize),
      }, ...prev]);
    } catch (err: any) {
      message.error(t('transfer.sendFailed', { error: err }));
    } finally {
      setSending(false);
    }
  };

  // === 剪贴板: 手机 -> 电脑 / Clipboard: Device -> Desktop ===
  const handleReceiveFromDevice = async () => {
    setReceiving(true);
    try {
      const result = await tauriInvoke<ClipboardResult>('get_clipboard_content', {
        serial: device.serial,
      });
      setDeviceClipText(result.text || '');
      setLastReceiveResult(result);
      message.success(t('transfer.gotClipboard', { length: result.length, method: methodLabels[result.method] || result.method }));
      setTransferHistory((prev) => [{
        type: 'clipboard', name: `${result.length} ${t('common.chars')}`, time: new Date().toLocaleTimeString(),
        direction: 'receive', method: result.method, size: formatFileSize(result.byteSize),
      }, ...prev]);
    } catch (err: any) {
      message.error(t('transfer.getFailed', { error: err }));
    } finally {
      setReceiving(false);
    }
  };

  const handleCopyToLocal = () => {
    if (deviceClipText) {
      navigator.clipboard.writeText(deviceClipText).then(() => {
        message.success(t('transfer.copiedToPC'));
      });
    }
  };

  const handlePasteFromLocal = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setClipText(text);
    } catch {
      message.warning(t('transfer.cannotReadClipboard'));
    }
  };

  // === 文件传输 / File Transfer ===
  const handleSendFile = async () => {
    try {
      const filePath = await open({ multiple: false, title: t('transfer.selectFile') });
      if (!filePath) return;
      setFileSending(true);
      const fileName = (filePath as string).split(/[/\\]/).pop() || 'file';
      const remotePath = `/sdcard/Download/${fileName}`;
      await tauriInvoke('send_file_to_device', { serial: device.serial, localPath: filePath as string, remotePath });
      message.success(t('transfer.fileSent', { name: fileName }));
      setTransferHistory((prev) => [{
        type: 'file', name: fileName, time: new Date().toLocaleTimeString(), direction: 'send',
      }, ...prev]);
    } catch (err: any) {
      message.error(t('transfer.sendFailed', { error: err }));
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
      message.success(t('transfer.folderSent', { name: folderName }));
      setTransferHistory((prev) => [{
        type: 'folder', name: folderName, time: new Date().toLocaleTimeString(), direction: 'send',
      }, ...prev]);
    } catch (err: any) {
      message.error(t('transfer.sendFailed', { error: err }));
    } finally {
      setFileSending(false);
    }
  };

  const handleReceiveFile = async () => {
    const remotePath = window.prompt(t('transfer.enterDevicePath'), '/sdcard/');
    if (!remotePath) return;
    try {
      const savePath = await open({ directory: true, title: t('transfer.selectSaveLocation') });
      if (!savePath) return;
      setFileSending(true);
      const fileName = remotePath.split('/').pop() || 'file';
      const localPath = `${savePath}/${fileName}`;
      await tauriInvoke('receive_file_from_device', { serial: device.serial, remotePath, localPath });
      message.success(t('transfer.fileReceived', { name: fileName }));
      setTransferHistory((prev) => [{
        type: 'file', name: fileName, time: new Date().toLocaleTimeString(), direction: 'receive',
      }, ...prev]);
    } catch (err: any) {
      message.error(t('transfer.receiveFailed', { error: err }));
    } finally {
      setFileSending(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>{t('transfer.title')}</h2>
        {clipInfo && (
          <Space>
            <Tag icon={<UsbOutlined />} color="success">{t('transfer.pureUsb')}</Tag>
            {clipInfo.companion_installed && (
              <Tag color="blue">{t('transfer.companionInstalled')}</Tag>
            )}
            <Tooltip title={t('transfer.maxTransferInfo', { size: formatFileSize(clipInfo.max_size) })}>
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        )}
      </div>
      <div className="page-body">
        <Tabs items={[
          {
            key: 'clipboard',
            label: <span><CopyOutlined /> {t('transfer.clipboard')}</span>,
            children: (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 1000 }}>
                {/* 电脑 -> 手机 / Desktop -> Device */}
                <Card
                  size="small"
                  title={<span><SendOutlined /> {t('transfer.pcToPhone')}</span>}
                  extra={
                    <Button size="small" onClick={handlePasteFromLocal}>{t('common.paste')}</Button>
                  }
                >
                  <TextArea
                    rows={10}
                    value={clipText}
                    onChange={(e) => setClipText(e.target.value)}
                    placeholder={t('transfer.inputPlaceholder')}
                    style={{ marginBottom: 12, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Space size="small">
                      <Tag>{textCharCount.toLocaleString()} {t('common.chars')}</Tag>
                      <Tag color={isOverLimit ? 'error' : 'default'}>{formatFileSize(textByteSize)}</Tag>
                    </Space>
                    {lastSendResult && (
                      <Tag icon={<CheckCircleOutlined />} color="success">
                        {methodLabels[lastSendResult.method] || lastSendResult.method}
                      </Tag>
                    )}
                  </div>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleSendToDevice}
                    loading={sending}
                    disabled={!clipText.trim() || isOverLimit}
                    block
                  >
                    {t('transfer.sendToDevice')}
                  </Button>
                </Card>

                {/* 手机 -> 电脑 / Device -> Desktop */}
                <Card
                  size="small"
                  title={<span><DownloadOutlined /> {t('transfer.phoneToPC')}</span>}
                  extra={
                    <Button size="small" onClick={handleCopyToLocal} disabled={!deviceClipText}>
                      {t('common.copy')}
                    </Button>
                  }
                >
                  <div
                    style={{
                      minHeight: 226,
                      maxHeight: 226,
                      overflow: 'auto',
                      padding: '8px 12px',
                      background: '#fafafa',
                      borderRadius: 6,
                      border: '1px solid #d9d9d9',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: 'inherit',
                      fontSize: 14,
                      marginBottom: 12,
                      color: deviceClipText ? '#262626' : '#bfbfbf',
                    }}
                  >
                    {deviceClipText || t('transfer.getDeviceClipboard')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Space size="small">
                      {deviceClipText && (
                        <>
                          <Tag>{deviceClipText.length.toLocaleString()} {t('common.chars')}</Tag>
                          <Tag>{formatFileSize(new TextEncoder().encode(deviceClipText).length)}</Tag>
                        </>
                      )}
                    </Space>
                    {lastReceiveResult && (
                      <Tag icon={<CheckCircleOutlined />} color="success">
                        {methodLabels[lastReceiveResult.method] || lastReceiveResult.method}
                      </Tag>
                    )}
                  </div>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={handleReceiveFromDevice}
                    loading={receiving}
                    block
                  >
                    {t('transfer.getFromDevice')}
                  </Button>
                </Card>

                <div style={{ gridColumn: '1 / -1' }}>
                  <Alert
                    type="info"
                    showIcon
                    message={t('transfer.clipboardInfoTitle')}
                    description={
                      <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                        <li>{t('transfer.clipboardInfo1')}</li>
                        <li>{t('transfer.clipboardInfo2')}</li>
                        <li>{t('transfer.clipboardInfo3')}</li>
                        <li>{t('transfer.clipboardInfo4')}</li>
                        <li>{t('transfer.clipboardInfo5')}</li>
                        <li>{t('transfer.clipboardInfo6')}</li>
                      </ul>
                    }
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'files',
            label: <span><FileOutlined /> {t('transfer.fileTransfer')}</span>,
            children: (
              <div style={{ maxWidth: 640 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Card size="small" title={t('transfer.pcToPhone')}>
                    <Space wrap>
                      <Button icon={<UploadOutlined />} onClick={handleSendFile} loading={fileSending}>
                        {t('transfer.sendFile')}
                      </Button>
                      <Button icon={<FolderOutlined />} onClick={handleSendFolder} loading={fileSending}>
                        {t('transfer.sendFolder')}
                      </Button>
                    </Space>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                      {t('transfer.pcToPhoneDesc')}
                    </div>
                  </Card>

                  <Card size="small" title={t('transfer.phoneToPC')}>
                    <Button icon={<DownloadOutlined />} onClick={handleReceiveFile} loading={fileSending}>
                      {t('transfer.receiveFile')}
                    </Button>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                      {t('transfer.phoneToPCDesc')}
                    </div>
                  </Card>
                </Space>
              </div>
            ),
          },
          {
            key: 'history',
            label: <span><SwapOutlined /> {t('transfer.transferHistory')}</span>,
            children: (
              <div style={{ maxWidth: 640 }}>
                {transferHistory.length === 0 ? (
                  <Empty description={t('transfer.noHistory')} />
                ) : (
                  <List
                    size="small"
                    dataSource={transferHistory}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          {item.type === 'clipboard' ? <CopyOutlined /> : item.type === 'folder' ? <FolderOutlined /> : <FileOutlined />}
                          <span>{item.name}</span>
                          <Tag color={item.direction === 'send' ? 'blue' : 'green'}>
                            {item.direction === 'send' ? t('transfer.directionSend') : t('transfer.directionReceive')}
                          </Tag>
                          {item.method && <Tag>{methodLabels[item.method] || item.method}</Tag>}
                          {item.size && <Tag>{item.size}</Tag>}
                          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{item.time}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            ),
          },
        ]} />
      </div>
    </>
  );
}
