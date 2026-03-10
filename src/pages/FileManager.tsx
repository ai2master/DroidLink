import { useState, useEffect, useCallback } from 'react';
import { Button, Space, Table, Breadcrumb, Dropdown, Modal, Input, message, Spin, Empty, Tooltip } from 'antd';
import {
  FolderOutlined, FileOutlined, ArrowUpOutlined, ReloadOutlined,
  DeleteOutlined, FolderAddOutlined, DownloadOutlined, UploadOutlined,
  HomeOutlined, FileZipOutlined, FileImageOutlined, FileTextOutlined,
  VideoCameraOutlined, SoundOutlined, MoreOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatFileSize, formatDate } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';

interface FileEntry {
  name: string;
  path: string;
  file_type: string;
  size: number;
  modified: string;
  permissions: string;
}

const fileIcon = (entry: FileEntry) => {
  if (entry.file_type === 'directory') return <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return <FileImageOutlined style={{ color: '#1677ff', fontSize: 18 }} />;
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv'].includes(ext))
    return <VideoCameraOutlined style={{ color: '#722ed1', fontSize: 18 }} />;
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext))
    return <SoundOutlined style={{ color: '#eb2f96', fontSize: 18 }} />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return <FileZipOutlined style={{ color: '#fa8c16', fontSize: 18 }} />;
  if (['txt', 'md', 'log', 'json', 'xml', 'csv'].includes(ext))
    return <FileTextOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
  return <FileOutlined style={{ color: '#8c8c8c', fontSize: 18 }} />;
};

export default function FileManager() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const [currentPath, setCurrentPath] = useState('/sdcard');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadFiles = useCallback(async (path: string) => {
    if (!device) return;
    setLoading(true);
    try {
      const result = await tauriInvoke<FileEntry[]>('list_files', { serial: device.serial, remotePath: path });
      setFiles(result);
      setCurrentPath(path);
      setSelectedKeys([]);
    } catch (err: any) {
      message.error(t('fileManager.loadFailed', { error: err }));
    } finally {
      setLoading(false);
    }
  }, [device, t]);

  useEffect(() => {
    if (device) loadFiles('/sdcard');
  }, [device, loadFiles]);

  if (!device) {
    return (
      <div className="app-content">
        <div className="page-header"><h2>{t('fileManager.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Empty description={t('fileManager.connectDeviceDesc')} />
        </div>
      </div>
    );
  }

  const navigateTo = (path: string) => loadFiles(path);

  const goUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  };

  const handleDoubleClick = (record: FileEntry) => {
    if (record.file_type === 'directory') {
      navigateTo(record.path);
    }
  };

  const handleDownload = async (record: FileEntry) => {
    try {
      const savePath = await open({ directory: true, title: t('fileManager.selectSaveLocation') });
      if (!savePath) return;
      const localPath = `${savePath}/${record.name}`;
      await tauriInvoke('pull_file', { serial: device.serial, remotePath: record.path, localPath });
      message.success(t('fileManager.downloaded', { name: record.name }));
    } catch (err: any) {
      message.error(t('fileManager.downloadFailed', { error: err }));
    }
  };

  const handleUpload = async () => {
    try {
      const filePath = await open({ multiple: false, title: t('fileManager.selectUploadFile') });
      if (!filePath) return;
      const fileName = (filePath as string).split(/[/\\]/).pop();
      const remotePath = `${currentPath}/${fileName}`;
      await tauriInvoke('push_file', { serial: device.serial, localPath: filePath as string, remotePath });
      message.success(t('fileManager.uploaded', { name: fileName }));
      loadFiles(currentPath);
    } catch (err: any) {
      message.error(t('fileManager.uploadFailed', { error: err }));
    }
  };

  const handleDelete = (record: FileEntry) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('fileManager.deleteConfirm', {
        name: record.name,
        extra: record.file_type === 'directory' ? t('fileManager.deleteConfirmDir') : '',
      }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('delete_file', { serial: device.serial, remotePath: record.path });
          message.success(t('fileManager.deleted'));
          loadFiles(currentPath);
        } catch (err: any) {
          message.error(t('fileManager.deleteFailed', { error: err }));
        }
      },
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const path = `${currentPath}/${newFolderName.trim()}`;
      await tauriInvoke('create_folder', { serial: device.serial, remotePath: path });
      message.success(t('fileManager.folderCreated'));
      setNewFolderVisible(false);
      setNewFolderName('');
      loadFiles(currentPath);
    } catch (err: any) {
      message.error(t('fileManager.createFailed', { error: err }));
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  const columns = [
    {
      title: t('fileManager.name'),
      dataIndex: 'name',
      key: 'name',
      render: (_: string, record: FileEntry) => (
        <Space>
          {fileIcon(record)}
          <span style={{ cursor: record.file_type === 'directory' ? 'pointer' : 'default' }}>
            {record.name}
          </span>
        </Space>
      ),
      sorter: (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name),
    },
    {
      title: t('fileManager.size'),
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number, record: FileEntry) =>
        record.file_type === 'directory' ? '-' : formatFileSize(size),
      sorter: (a: FileEntry, b: FileEntry) => a.size - b.size,
    },
    {
      title: t('fileManager.modified'),
      dataIndex: 'modified',
      key: 'modified',
      width: 160,
      render: (date: string) => formatDate(date),
      sorter: (a: FileEntry, b: FileEntry) => a.modified.localeCompare(b.modified),
    },
    {
      title: t('fileManager.permissions'),
      dataIndex: 'permissions',
      key: 'permissions',
      width: 120,
      responsive: ['lg' as const],
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 100,
      render: (_: any, record: FileEntry) => (
        <Space size="small">
          {record.file_type !== 'directory' && (
            <Tooltip title={t('fileManager.download')}>
              <Button type="text" size="small" icon={<DownloadOutlined />} onClick={(e) => { e.stopPropagation(); handleDownload(record); }} />
            </Tooltip>
          )}
          <Tooltip title={t('common.delete')}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); handleDelete(record); }} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <Space>
          <h2>{t('fileManager.title')}</h2>
          <Breadcrumb
            items={[
              { title: <HomeOutlined />, onClick: () => navigateTo('/'), className: 'breadcrumb-item' },
              ...pathParts.map((part, i) => ({
                title: part,
                onClick: () => navigateTo('/' + pathParts.slice(0, i + 1).join('/')),
                className: i === pathParts.length - 1 ? 'breadcrumb-item current' : 'breadcrumb-item',
              })),
            ]}
          />
        </Space>
        <Space>
          <Button icon={<ArrowUpOutlined />} onClick={goUp} disabled={currentPath === '/'}>{t('common.goUp')}</Button>
          <Button icon={<UploadOutlined />} onClick={handleUpload}>{t('fileManager.upload')}</Button>
          <Button icon={<FolderAddOutlined />} onClick={() => setNewFolderVisible(true)}>{t('fileManager.newFolder')}</Button>
          <Button icon={<ReloadOutlined />} onClick={() => loadFiles(currentPath)}>{t('common.refresh')}</Button>
        </Space>
      </div>
      <div className="page-body">
        <Spin spinning={loading}>
          <Table
            dataSource={files}
            columns={columns}
            rowKey="path"
            size="small"
            pagination={{ pageSize: 100, showSizeChanger: true, showTotal: (total) => t('common.totalItems', { total }) }}
            onRow={(record) => ({
              onDoubleClick: () => handleDoubleClick(record),
            })}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: (keys) => setSelectedKeys(keys as string[]),
            }}
            locale={{ emptyText: <Empty description={t('fileManager.emptyDir')} /> }}
          />
        </Spin>
      </div>
      <Modal
        title={t('fileManager.newFolder')}
        open={newFolderVisible}
        onOk={handleCreateFolder}
        onCancel={() => { setNewFolderVisible(false); setNewFolderName(''); }}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
      >
        <Input
          placeholder={t('fileManager.folderName')}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>
    </>
  );
}
