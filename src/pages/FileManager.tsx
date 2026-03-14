import { useState, useEffect, useCallback } from 'react';
import {
  Folder, File, ArrowUp, RotateCw, Trash2, FolderPlus, Download, Upload,
  Home, FileArchive, FileImage, FileText, Video, Music,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatFileSize, formatDate } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { cn } from '../utils/cn';

interface FileEntry {
  name: string;
  path: string;
  fileType: string;
  size: number;
  modified: string;
  permissions: string;
}

const fileIcon = (entry: FileEntry) => {
  if (entry.fileType === 'directory') return <Folder className="text-[#faad14]" size={18} />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return <FileImage className="text-[#1677ff]" size={18} />;
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv'].includes(ext))
    return <Video className="text-[#722ed1]" size={18} />;
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext))
    return <Music className="text-[#eb2f96]" size={18} />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return <FileArchive className="text-[#fa8c16]" size={18} />;
  if (['txt', 'md', 'log', 'json', 'xml', 'csv'].includes(ext))
    return <FileText className="text-[#52c41a]" size={18} />;
  return <File className="text-gray-400" size={18} />;
};

export default function FileManager() {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm } = useConfirm();
  const device = useStore((s) => s.connectedDevice);
  const [currentPath, setCurrentPath] = useState('/sdcard');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [sortBy, setSortBy] = useState<{ key: string; asc: boolean }>({ key: 'name', asc: true });

  const loadFiles = useCallback(async (path: string) => {
    if (!device) return;
    setLoading(true);
    try {
      const result = await tauriInvoke<FileEntry[]>('list_files', { serial: device.serial, remotePath: path });
      setFiles(result);
      setCurrentPath(path);
      setSelectedKeys([]);
    } catch (err: any) {
      toast.error(t('fileManager.loadFailed', { error: err }));
    } finally {
      setLoading(false);
    }
  }, [device, t, toast]);

  useEffect(() => {
    if (device) loadFiles('/sdcard');
  }, [device, loadFiles]);

  if (!device) {
    return (
      <div className="app-content">
        <div className="page-header"><h2>{t('fileManager.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <div className="text-center py-12 text-gray-400">{t('fileManager.connectDeviceDesc')}</div>
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
    if (record.fileType === 'directory') {
      navigateTo(record.path);
    }
  };

  const handleDownload = async (record: FileEntry) => {
    try {
      const savePath = await open({ directory: true, title: t('fileManager.selectSaveLocation') });
      if (!savePath) return;
      const localPath = `${savePath}/${record.name}`;
      if (record.fileType === 'directory') {
        await tauriInvoke('pull_directory', { serial: device.serial, remotePath: record.path, localPath });
      } else {
        await tauriInvoke('pull_file', { serial: device.serial, remotePath: record.path, localPath });
      }
      toast.success(t('fileManager.downloaded', { name: record.name }));
    } catch (err: any) {
      toast.error(t('fileManager.downloadFailed', { error: err }));
    }
  };

  const handleUpload = async () => {
    try {
      const filePath = await open({ multiple: false, title: t('fileManager.selectUploadFile') });
      if (!filePath) return;
      const fileName = (filePath as string).split(/[/\\]/).pop();
      const remotePath = `${currentPath}/${fileName}`;
      await tauriInvoke('push_file', { serial: device.serial, localPath: filePath as string, remotePath });
      toast.success(t('fileManager.uploaded', { name: fileName }));
      loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.uploadFailed', { error: err }));
    }
  };

  const handleDelete = (record: FileEntry) => {
    confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('fileManager.deleteConfirm', {
        name: record.name,
        extra: record.fileType === 'directory' ? t('fileManager.deleteConfirmDir') : '',
      }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      onOk: async () => {
        try {
          await tauriInvoke('delete_file', { serial: device.serial, remotePath: record.path });
          toast.success(t('fileManager.deleted'));
          loadFiles(currentPath);
        } catch (err: any) {
          toast.error(t('fileManager.deleteFailed', { error: err }));
        }
      },
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const path = `${currentPath}/${newFolderName.trim()}`;
      await tauriInvoke('create_folder', { serial: device.serial, remotePath: path });
      toast.success(t('fileManager.folderCreated'));
      setNewFolderVisible(false);
      setNewFolderName('');
      loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.createFailed', { error: err }));
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  const handleSort = (key: string) => {
    setSortBy((prev) => ({
      key,
      asc: prev.key === key ? !prev.asc : true,
    }));
  };

  const sortedFiles = [...files].sort((a, b) => {
    const { key, asc } = sortBy;
    let result = 0;
    if (key === 'name') result = a.name.localeCompare(b.name);
    else if (key === 'size') result = a.size - b.size;
    else if (key === 'modified') result = a.modified.localeCompare(b.modified);
    return asc ? result : -result;
  });

  return (
    <>
      <div className="page-header">
        <div className="flex items-center gap-2">
          <h2>{t('fileManager.title')}</h2>
          <nav className="flex items-center gap-1 text-[var(--font-size-sm)]">
            <button
              onClick={() => navigateTo('/')}
              className="px-2 py-1 hover:bg-gray-100 rounded transition-colors"
            >
              <Home size={14} />
            </button>
            {pathParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-gray-400">/</span>
                <button
                  onClick={() => navigateTo('/' + pathParts.slice(0, i + 1).join('/'))}
                  className={cn(
                    "px-2 py-1 hover:bg-gray-100 rounded transition-colors",
                    i === pathParts.length - 1 && "font-semibold"
                  )}
                >
                  {part}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={goUp} disabled={currentPath === '/'}>
            <ArrowUp size={16} />
            {t('common.goUp')}
          </Button>
          <Button onClick={handleUpload}>
            <Upload size={16} />
            {t('fileManager.upload')}
          </Button>
          <Button onClick={() => setNewFolderVisible(true)}>
            <FolderPlus size={16} />
            {t('fileManager.newFolder')}
          </Button>
          <Button onClick={() => loadFiles(currentPath)}>
            <RotateCw size={16} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
        ) : (
          <table className="w-full text-left text-[var(--font-size-base)]">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="p-3 font-semibold cursor-pointer hover:bg-gray-100" onClick={() => handleSort('name')}>
                  {t('fileManager.name')} {sortBy.key === 'name' && (sortBy.asc ? '↑' : '↓')}
                </th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-gray-100 w-[120px]" onClick={() => handleSort('size')}>
                  {t('fileManager.size')} {sortBy.key === 'size' && (sortBy.asc ? '↑' : '↓')}
                </th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-gray-100 w-[160px]" onClick={() => handleSort('modified')}>
                  {t('fileManager.modified')} {sortBy.key === 'modified' && (sortBy.asc ? '↑' : '↓')}
                </th>
                <th className="p-3 font-semibold w-[120px] hidden lg:table-cell">{t('fileManager.permissions')}</th>
                <th className="p-3 font-semibold w-[100px]">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">{t('fileManager.emptyDir')}</td>
                </tr>
              ) : (
                sortedFiles.map((record) => (
                  <tr
                    key={record.path}
                    className="border-b border-border hover:bg-gray-50 transition-colors"
                    onDoubleClick={() => handleDoubleClick(record)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {fileIcon(record)}
                        {record.fileType === 'directory' ? (
                          <button
                            className="cursor-pointer hover:text-[#1677ff] hover:underline text-left"
                            onClick={(e) => { e.stopPropagation(); navigateTo(record.path); }}
                          >
                            {record.name}
                          </button>
                        ) : (
                          <span>{record.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {record.fileType === 'directory' ? '-' : formatFileSize(record.size)}
                    </td>
                    <td className="p-3">{formatDate(record.modified)}</td>
                    <td className="p-3 hidden lg:table-cell">{record.permissions}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleDownload(record); }}
                            >
                              <Download size={16} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('fileManager.download')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleDelete(record); }}
                            >
                              <Trash2 size={16} className="text-red-500" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('common.delete')}</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <Dialog open={newFolderVisible} onOpenChange={setNewFolderVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('fileManager.newFolder')}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t('fileManager.folderName')}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewFolderVisible(false); setNewFolderName(''); }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleCreateFolder}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
