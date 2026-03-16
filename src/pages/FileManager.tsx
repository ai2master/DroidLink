import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder, File, ArrowUp, RotateCw, Trash2, FolderPlus, Download, Upload,
  Home, FileArchive, FileImage, FileText, Video, Music,
  Search, Pencil, Copy, Scissors, ClipboardPaste, CheckSquare, Square,
  FolderInput, X, ChevronRight, HardDrive, Smartphone, FolderOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke, tauriListen } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatFileSize, formatDate } from '../utils/format';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ui/confirm-dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '../components/ui/dropdown-menu';
import { cn } from '../utils/cn';

interface FileEntry {
  name: string;
  path: string;
  fileType: string;
  size: number;
  modified: string;
  permissions: string;
}

// 内部剪贴板状态 / Internal clipboard for copy/cut
interface FileClipboard {
  files: FileEntry[];
  operation: 'copy' | 'cut';
}

const fileIcon = (entry: FileEntry) => {
  if (entry.fileType === 'directory') return <Folder className="text-[#faad14]" size={18} />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return <FileImage className="text-[#059669]" size={18} />;
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
  const [sortBy, setSortBy] = useState<{ key: string; asc: boolean }>({ key: 'name', asc: true });

  // 多选状态 / Multi-select state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<number>(-1);

  // 上下文菜单 / Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; record: FileEntry | null } | null>(null);

  // 对话框状态 / Dialog state
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState('');
  const [copyMoveVisible, setCopyMoveVisible] = useState(false);
  const [copyMoveOp, setCopyMoveOp] = useState<'copy' | 'move'>('copy');
  const [copyMoveTargetPath, setCopyMoveTargetPath] = useState('/sdcard');
  const [copyMoveBrowseFiles, setCopyMoveBrowseFiles] = useState<FileEntry[]>([]);
  const [copyMoveTab, setCopyMoveTab] = useState<'device' | 'local'>('device');
  const [copyMoveLocalPath, setCopyMoveLocalPath] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchPattern, setSearchPattern] = useState('');
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [searching, setSearching] = useState(false);

  // 内部剪贴板 / Internal file clipboard
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);

  // 拖放覆盖层 / Drag-drop overlay
  const [dragOver, setDragOver] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);
  // 使用 ref 跟踪最新的 currentPath 避免异步回调中的闭包陈旧问题
  // Track latest currentPath via ref to avoid stale closures in async callbacks
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  // ============ 加载文件列表 / Load file list ============
  const loadFiles = useCallback(async (path: string) => {
    if (!device) return;
    setLoading(true);
    try {
      const result = await tauriInvoke<FileEntry[]>('list_files', { serial: device.serial, remotePath: path });
      setFiles(result);
      setCurrentPath(path);
      setSelectedPaths(new Set());
      lastClickedRef.current = -1;
    } catch (err: any) {
      toast.error(t('fileManager.loadFailed', { error: err }));
    } finally {
      setLoading(false);
    }
  }, [device, t, toast]);

  useEffect(() => {
    if (device) loadFiles('/sdcard');
  }, [device, loadFiles]);

  // ============ Tauri 文件拖放事件 / Tauri file-drop events ============
  useEffect(() => {
    const unlistenEnter = tauriListen('tauri://drag-enter', () => setDragOver(true));
    const unlistenLeave = tauriListen('tauri://drag-leave', () => setDragOver(false));
    const unlistenDrop = tauriListen('tauri://drag-drop', async (event: any) => {
      setDragOver(false);
      if (!device) return;
      const paths: string[] = event?.paths || event?.payload?.paths || [];
      if (paths.length === 0) return;
      // 使用 ref 获取最新路径，避免闭包陈旧 / Use ref for latest path to avoid stale closure
      const targetPath = currentPathRef.current;
      let uploaded = 0;
      for (const localPath of paths) {
        try {
          const fileName = localPath.split(/[/\\]/).pop() || 'file';
          const remotePath = `${targetPath}/${fileName}`;
          await tauriInvoke('push_file', { serial: device.serial, localPath, remotePath });
          uploaded++;
        } catch (err: any) {
          toast.error(t('fileManager.uploadFailed', { error: err }));
        }
      }
      if (uploaded > 0) {
        toast.success(t('fileManager.uploaded', { name: `${uploaded} ${t('common.items')}` }));
        loadFiles(targetPath);
      }
    });
    return () => {
      unlistenEnter.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
    };
  }, [device, loadFiles, t, toast]);

  // ============ 键盘快捷键 / Keyboard shortcuts ============
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!device) return;
      // 如果焦点在 input/textarea 中，忽略 / Ignore if focused in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (e.key === 'Delete') {
        e.preventDefault();
        handleBatchDelete();
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (selectedPaths.size === 1) {
          const path = [...selectedPaths][0];
          const file = files.find((f) => f.path === path);
          if (file) openRename(file);
        }
      } else if (ctrlOrMeta && e.key === 'a') {
        e.preventDefault();
        setSelectedPaths(new Set(sortedFiles.map((f) => f.path)));
      } else if (ctrlOrMeta && e.key === 'c') {
        e.preventDefault();
        handleCopyToClipboard();
      } else if (ctrlOrMeta && e.key === 'x') {
        e.preventDefault();
        handleCutToClipboard();
      } else if (ctrlOrMeta && e.key === 'v') {
        e.preventDefault();
        handlePasteFromClipboard();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (currentPath !== '/') goUp();
      } else if (ctrlOrMeta && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // ============ 关闭上下文菜单 / Close context menu on click ============
  useEffect(() => {
    const close = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
      return () => {
        window.removeEventListener('click', close);
        window.removeEventListener('contextmenu', close);
      };
    }
  }, [contextMenu]);

  // ============ 无设备 / No device connected ============
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

  // ============ 导航 / Navigation ============
  const navigateTo = (path: string) => loadFiles(path);
  const goUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  };

  // ============ 排序 / Sorting ============
  const handleSort = (key: string) => {
    setSortBy((prev) => ({ key, asc: prev.key === key ? !prev.asc : true }));
  };
  const sortedFiles = [...files].sort((a, b) => {
    const { key, asc } = sortBy;
    let result = 0;
    if (key === 'name') result = a.name.localeCompare(b.name);
    else if (key === 'size') result = a.size - b.size;
    else if (key === 'modified') result = a.modified.localeCompare(b.modified);
    return asc ? result : -result;
  });

  // ============ 多选逻辑 / Selection logic ============
  const handleRowClick = (e: React.MouseEvent, record: FileEntry, index: number) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle individual
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(record.path)) next.delete(record.path);
        else next.add(record.path);
        return next;
      });
      lastClickedRef.current = index;
    } else if (e.shiftKey && lastClickedRef.current >= 0) {
      // Range select
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const range = sortedFiles.slice(start, end + 1).map((f) => f.path);
      setSelectedPaths(new Set(range));
    } else {
      // Normal click: single select
      setSelectedPaths(new Set([record.path]));
      lastClickedRef.current = index;
    }
  };

  const handleSelectAll = () => {
    if (selectedPaths.size === sortedFiles.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(sortedFiles.map((f) => f.path)));
    }
  };

  const getSelectedFiles = (): FileEntry[] =>
    files.filter((f) => selectedPaths.has(f.path));

  // ============ 单项操作 / Single item operations ============
  const handleDownload = async (record: FileEntry) => {
    try {
      const savePath = await openDialog({ directory: true, title: t('fileManager.selectSaveLocation') });
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
      const filePath = await openDialog({ multiple: false, title: t('fileManager.selectUploadFile') });
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

  const handleDeleteSingle = (record: FileEntry) => {
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

  // ============ 批量操作 / Batch operations ============
  const handleBatchDelete = () => {
    const selected = getSelectedFiles();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      handleDeleteSingle(selected[0]);
      return;
    }
    confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('fileManager.batchDeleteConfirm', { count: selected.length }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      onOk: async () => {
        try {
          const result = await tauriInvoke<{ succeeded: number; failed: any[] }>('batch_delete_files', {
            serial: device.serial,
            paths: selected.map((f) => f.path),
          });
          toast.success(t('fileManager.batchDeleted', { count: result.succeeded }));
          if (result.failed.length > 0) {
            toast.error(t('fileManager.batchPartialFail', { count: result.failed.length }));
          }
          loadFiles(currentPath);
        } catch (err: any) {
          toast.error(t('fileManager.deleteFailed', { error: err }));
        }
      },
    });
  };

  const handleBatchDownload = async () => {
    const selected = getSelectedFiles();
    if (selected.length === 0) return;
    try {
      const savePath = await openDialog({ directory: true, title: t('fileManager.selectSaveLocation') });
      if (!savePath) return;
      let downloaded = 0;
      for (const file of selected) {
        const localPath = `${savePath}/${file.name}`;
        if (file.fileType === 'directory') {
          await tauriInvoke('pull_directory', { serial: device.serial, remotePath: file.path, localPath });
        } else {
          await tauriInvoke('pull_file', { serial: device.serial, remotePath: file.path, localPath });
        }
        downloaded++;
      }
      toast.success(t('fileManager.downloaded', { name: `${downloaded} ${t('common.items')}` }));
    } catch (err: any) {
      toast.error(t('fileManager.downloadFailed', { error: err }));
    }
  };

  // ============ 重命名 / Rename ============
  const openRename = (record: FileEntry) => {
    setRenameTarget(record);
    // 自动选中文件名但不包括扩展名 / Select filename without extension
    const dotIndex = record.name.lastIndexOf('.');
    setRenameName(record.name);
    setRenameVisible(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.rename-input');
      if (input) {
        input.focus();
        if (record.fileType !== 'directory' && dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      }
    }, 50);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim() || renameName === renameTarget.name) {
      setRenameVisible(false);
      return;
    }
    try {
      const dir = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/'));
      const newPath = `${dir}/${renameName.trim()}`;
      await tauriInvoke('rename_file', { serial: device.serial, oldPath: renameTarget.path, newPath });
      toast.success(t('fileManager.renamed'));
      setRenameVisible(false);
      loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.renameFailed', { error: err }));
    }
  };

  // ============ 复制/移动至 / Copy/Move to ============
  const openCopyMoveTo = (op: 'copy' | 'move') => {
    if (selectedPaths.size === 0) return;
    setCopyMoveOp(op);
    setCopyMoveTargetPath('/sdcard');
    setCopyMoveTab('device');
    setCopyMoveLocalPath('');
    setCopyMoveVisible(true);
    loadCopyMoveBrowse('/sdcard');
  };

  const loadCopyMoveBrowse = async (path: string) => {
    if (!device) return;
    try {
      const result = await tauriInvoke<FileEntry[]>('list_files', { serial: device.serial, remotePath: path });
      setCopyMoveBrowseFiles(result.filter((f) => f.fileType === 'directory'));
      setCopyMoveTargetPath(path);
    } catch {
      setCopyMoveBrowseFiles([]);
    }
  };

  const handleCopyMove = async () => {
    const selected = getSelectedFiles();
    if (selected.length === 0) return;
    try {
      const cmd = copyMoveOp === 'copy' ? 'batch_copy_files' : 'batch_move_files';
      const result = await tauriInvoke<{ succeeded: number; failed: any[] }>(cmd, {
        serial: device.serial,
        files: selected.map((f) => f.path),
        destination: copyMoveTargetPath,
      });
      const msgKey = copyMoveOp === 'copy' ? 'fileManager.batchCopied' : 'fileManager.batchMoved';
      toast.success(t(msgKey, { count: result.succeeded }));
      setCopyMoveVisible(false);
      loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.operationFailed', { error: err }));
    }
  };

  // ============ 复制/移动到本地PC / Copy/Move to local PC ============
  const handleCopyMoveToLocal = async () => {
    const selected = getSelectedFiles();
    if (selected.length === 0 || !copyMoveLocalPath) return;
    try {
      let succeeded = 0;
      for (const file of selected) {
        const localPath = `${copyMoveLocalPath}/${file.name}`;
        if (file.fileType === 'directory') {
          await tauriInvoke('pull_directory', { serial: device!.serial, remotePath: file.path, localPath });
        } else {
          await tauriInvoke('pull_file', { serial: device!.serial, remotePath: file.path, localPath });
        }
        succeeded++;
      }
      // 如果是移动操作，删除源文件 / If move, delete source files
      if (copyMoveOp === 'move') {
        for (const file of selected) {
          try {
            await tauriInvoke('delete_file', { serial: device!.serial, remotePath: file.path });
          } catch {}
        }
      }
      const msgKey = copyMoveOp === 'copy' ? 'fileManager.batchCopied' : 'fileManager.batchMoved';
      toast.success(t(msgKey, { count: succeeded }));
      setCopyMoveVisible(false);
      if (copyMoveOp === 'move') loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.operationFailed', { error: err }));
    }
  };

  const selectLocalPath = async () => {
    const selected = await openDialog({ directory: true, title: t('fileManager.selectSaveLocation') });
    if (selected) setCopyMoveLocalPath(selected as string);
  };

  // ============ 内部剪贴板操作 / Internal clipboard ============
  const handleCopyToClipboard = () => {
    const selected = getSelectedFiles();
    if (selected.length === 0) return;
    setFileClipboard({ files: selected, operation: 'copy' });
    toast.info(t('fileManager.filesCopied', { count: selected.length }));
  };

  const handleCutToClipboard = () => {
    const selected = getSelectedFiles();
    if (selected.length === 0) return;
    setFileClipboard({ files: selected, operation: 'cut' });
    toast.info(t('fileManager.filesCut', { count: selected.length }));
  };

  const handlePasteFromClipboard = async () => {
    if (!fileClipboard || fileClipboard.files.length === 0) return;
    try {
      const cmd = fileClipboard.operation === 'copy' ? 'batch_copy_files' : 'batch_move_files';
      await tauriInvoke(cmd, {
        serial: device.serial,
        files: fileClipboard.files.map((f) => f.path),
        destination: currentPath,
      });
      const msgKey = fileClipboard.operation === 'copy' ? 'fileManager.batchCopied' : 'fileManager.batchMoved';
      toast.success(t(msgKey, { count: fileClipboard.files.length }));
      if (fileClipboard.operation === 'cut') setFileClipboard(null);
      loadFiles(currentPath);
    } catch (err: any) {
      toast.error(t('fileManager.operationFailed', { error: err }));
    }
  };

  // ============ 搜索 / Search ============
  const handleSearch = async () => {
    if (!searchPattern.trim() || !device) return;
    setSearching(true);
    try {
      const results = await tauriInvoke<FileEntry[]>('search_files', {
        serial: device.serial,
        basePath: currentPath,
        pattern: searchPattern.trim(),
      });
      setSearchResults(results);
    } catch (err: any) {
      toast.error(t('fileManager.searchFailed', { error: err }));
    } finally {
      setSearching(false);
    }
  };

  const navigateToSearchResult = (result: FileEntry) => {
    const dir = result.path.substring(0, result.path.lastIndexOf('/')) || '/';
    setSearchVisible(false);
    setSearchResults([]);
    setSearchPattern('');
    navigateTo(dir);
  };

  // ============ 新建文件夹 / Create folder ============
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

  // ============ 拖出文件 (App -> 系统) / Drag out files (App -> System) ============
  const handleDragStart = async (e: React.DragEvent, record: FileEntry) => {
    // 设置拖拽数据用于视觉反馈 / Set drag data for visual feedback
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', record.name);
    // 通过 Tauri 拉取文件到临时目录，然后使用 startDrag API
    // Pull file to temp dir via Tauri, then use startDrag API
    // 注意: 目前 Web 拖放无法直接创建系统文件，需要 Tauri startDrag 插件
    // 此处使用下载方式替代: 用户拖出时提示下载
    // Note: Web drag-drop can't directly create system files. Tauri startDrag plugin needed.
    // For now, we use the download fallback: prompt to download when dragging out.
    try {
      const tmpDir = `/tmp/droidlink-drag`;
      const localPath = `${tmpDir}/${record.name}`;
      // 预拉取到临时目录 / Pre-pull to temp directory
      if (record.fileType === 'directory') {
        await tauriInvoke('pull_directory', { serial: device!.serial, remotePath: record.path, localPath });
      } else {
        await tauriInvoke('pull_file', { serial: device!.serial, remotePath: record.path, localPath });
      }
      // 设置文件 URI 用于系统拖放 / Set file URI for system drag-drop
      e.dataTransfer.setData('text/uri-list', `file://${localPath}`);
    } catch {
      // 拖拽失败时静默处理 / Silently handle drag failures
    }
  };

  // ============ 上下文菜单处理 / Context menu handler ============
  const handleContextMenu = (e: React.MouseEvent, record: FileEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    // 如果右键的项不在选中集合中，单选它 / If right-clicked item not in selection, select only it
    if (record && !selectedPaths.has(record.path)) {
      setSelectedPaths(new Set([record.path]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, record });
  };

  const pathParts = currentPath.split('/').filter(Boolean);
  const isAllSelected = sortedFiles.length > 0 && selectedPaths.size === sortedFiles.length;
  const isSomeSelected = selectedPaths.size > 0;

  // ============ 渲染 / Render ============
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
          <Button onClick={() => setSearchVisible(true)}>
            <Search size={16} />
            {t('common.search')}
          </Button>
          <Button onClick={() => loadFiles(currentPath)}>
            <RotateCw size={16} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 选择工具栏 / Selection toolbar */}
      {isSomeSelected && (
        <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50 border-b border-emerald-200">
          <span className="text-[var(--font-size-sm)] font-medium text-emerald-700">
            {t('fileManager.selectedCount', { count: selectedPaths.size })}
          </span>
          <Button size="sm" variant="outline" onClick={handleSelectAll}>
            {isAllSelected ? t('fileManager.deselectAll') : t('fileManager.selectAll')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedPaths(new Set())}>
            <X size={14} />
            {t('common.clear')}
          </Button>
          <div className="h-4 w-px bg-emerald-200" />
          <Button size="sm" variant="outline" onClick={handleBatchDownload}>
            <Download size={14} />
            {t('fileManager.download')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openCopyMoveTo('copy')}>
            <Copy size={14} />
            {t('fileManager.copyTo')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openCopyMoveTo('move')}>
            <FolderInput size={14} />
            {t('fileManager.moveTo')}
          </Button>
          <Button size="sm" variant="outline" onClick={handleBatchDelete} className="text-red-600 hover:text-red-700">
            <Trash2 size={14} />
            {t('common.delete')}
          </Button>
        </div>
      )}

      <div
        className="page-body relative"
        ref={tableRef}
        onContextMenu={(e) => handleContextMenu(e, null)}
      >
        {/* 拖放覆盖层 / Drag-drop overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-50/80 border-2 border-dashed border-emerald-400 rounded-lg pointer-events-none">
            <div className="text-center">
              <Upload size={48} className="mx-auto text-emerald-500 mb-2" />
              <p className="text-emerald-700 font-medium">{t('fileManager.dropFilesHere')}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
        ) : (
          <table className="w-full text-left text-[var(--font-size-base)]">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="p-3 w-[40px]">
                  <button onClick={handleSelectAll} className="flex items-center justify-center">
                    {isAllSelected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="text-gray-400" />}
                  </button>
                </th>
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
              </tr>
            </thead>
            <tbody>
              {sortedFiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">{t('fileManager.emptyDir')}</td>
                </tr>
              ) : (
                sortedFiles.map((record, idx) => {
                  const isSelected = selectedPaths.has(record.path);
                  return (
                    <tr
                      key={record.path}
                      className={cn(
                        "border-b border-border transition-colors cursor-default",
                        isSelected ? "bg-emerald-50" : "hover:bg-gray-50"
                      )}
                      draggable
                      onDragStart={(e) => handleDragStart(e, record)}
                      onClick={(e) => handleRowClick(e, record, idx)}
                      onDoubleClick={() => { if (record.fileType === 'directory') navigateTo(record.path); }}
                      onContextMenu={(e) => handleContextMenu(e, record)}
                    >
                      <td className="p-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPaths((prev) => {
                              const next = new Set(prev);
                              if (next.has(record.path)) next.delete(record.path);
                              else next.add(record.path);
                              return next;
                            });
                          }}
                          className="flex items-center justify-center"
                        >
                          {isSelected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="text-gray-400" />}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {fileIcon(record)}
                          {record.fileType === 'directory' ? (
                            <button
                              className="cursor-pointer hover:text-[#059669] hover:underline text-left"
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
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 上下文菜单 / Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] min-w-[200px] overflow-hidden rounded-md border border-border bg-white p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.record ? (
            <>
              {contextMenu.record.fileType === 'directory' && (
                <CtxItem onClick={() => { navigateTo(contextMenu.record!.path); setContextMenu(null); }}>
                  <Folder size={14} /> {t('fileManager.open')}
                </CtxItem>
              )}
              <CtxItem onClick={() => { handleDownload(contextMenu.record!); setContextMenu(null); }}>
                <Download size={14} /> {t('fileManager.download')}
              </CtxItem>
              <CtxItem onClick={() => { openRename(contextMenu.record!); setContextMenu(null); }}>
                <Pencil size={14} /> {t('fileManager.rename')} <span className="ml-auto text-gray-400 text-xs">F2</span>
              </CtxItem>
              <div className="h-px bg-border -mx-1 my-1" />
              <CtxItem onClick={() => {
                setFileClipboard({ files: getSelectedFiles().length > 0 ? getSelectedFiles() : [contextMenu.record!], operation: 'copy' });
                toast.info(t('fileManager.filesCopied', { count: 1 }));
                setContextMenu(null);
              }}>
                <Copy size={14} /> {t('fileManager.copyTo')} <span className="ml-auto text-gray-400 text-xs">Ctrl+C</span>
              </CtxItem>
              <CtxItem onClick={() => {
                setFileClipboard({ files: getSelectedFiles().length > 0 ? getSelectedFiles() : [contextMenu.record!], operation: 'cut' });
                toast.info(t('fileManager.filesCut', { count: 1 }));
                setContextMenu(null);
              }}>
                <Scissors size={14} /> {t('fileManager.cut')} <span className="ml-auto text-gray-400 text-xs">Ctrl+X</span>
              </CtxItem>
              <div className="h-px bg-border -mx-1 my-1" />
              <CtxItem onClick={() => { handleDeleteSingle(contextMenu.record!); setContextMenu(null); }} className="text-red-600">
                <Trash2 size={14} /> {t('common.delete')} <span className="ml-auto text-gray-400 text-xs">Del</span>
              </CtxItem>
            </>
          ) : (
            // 空白区域右键菜单 / Empty area context menu
            <>
              <CtxItem onClick={() => { setNewFolderVisible(true); setContextMenu(null); }}>
                <FolderPlus size={14} /> {t('fileManager.newFolder')}
              </CtxItem>
              <CtxItem onClick={() => { handleUpload(); setContextMenu(null); }}>
                <Upload size={14} /> {t('fileManager.upload')}
              </CtxItem>
              {fileClipboard && fileClipboard.files.length > 0 && (
                <CtxItem onClick={() => { handlePasteFromClipboard(); setContextMenu(null); }}>
                  <ClipboardPaste size={14} /> {t('common.paste')} ({fileClipboard.files.length})
                  <span className="ml-auto text-gray-400 text-xs">Ctrl+V</span>
                </CtxItem>
              )}
              <div className="h-px bg-border -mx-1 my-1" />
              <CtxItem onClick={() => { loadFiles(currentPath); setContextMenu(null); }}>
                <RotateCw size={14} /> {t('common.refresh')}
              </CtxItem>
            </>
          )}
        </div>
      )}

      {/* 新建文件夹对话框 / New folder dialog */}
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

      {/* 重命名对话框 / Rename dialog */}
      <Dialog open={renameVisible} onOpenChange={setRenameVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('fileManager.rename')}</DialogTitle>
          </DialogHeader>
          <Input
            className="rename-input"
            placeholder={t('fileManager.enterNewName')}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameVisible(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleRename} disabled={!renameName.trim() || renameName === renameTarget?.name}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 复制/移动至对话框 (带选项卡) / Copy/Move to dialog (with tabs) */}
      <Dialog open={copyMoveVisible} onOpenChange={setCopyMoveVisible}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {copyMoveOp === 'copy' ? t('fileManager.copyTo') : t('fileManager.moveTo')}
            </DialogTitle>
          </DialogHeader>
          {/* 选项卡 / Tabs */}
          <div className="flex border-b border-border">
            <button
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-[var(--font-size-sm)] font-medium border-b-2 transition-colors",
                copyMoveTab === 'device'
                  ? "border-emerald-500 text-emerald-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
              onClick={() => setCopyMoveTab('device')}
            >
              <Smartphone size={14} />
              {t('fileManager.tabDevice')}
            </button>
            <button
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-[var(--font-size-sm)] font-medium border-b-2 transition-colors",
                copyMoveTab === 'local'
                  ? "border-emerald-500 text-emerald-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
              onClick={() => setCopyMoveTab('local')}
            >
              <HardDrive size={14} />
              {t('fileManager.tabLocalPC')}
            </button>
          </div>

          {copyMoveTab === 'device' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[var(--font-size-sm)] text-gray-500">
                <span>{t('fileManager.destination')}:</span>
                <span className="font-mono">{copyMoveTargetPath}</span>
              </div>
              {copyMoveTargetPath !== '/' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const parent = copyMoveTargetPath.split('/').slice(0, -1).join('/') || '/';
                    loadCopyMoveBrowse(parent);
                  }}
                >
                  <ArrowUp size={14} /> {t('common.goUp')}
                </Button>
              )}
              <div className="max-h-[300px] overflow-y-auto border border-border rounded-md">
                {copyMoveBrowseFiles.length === 0 ? (
                  <div className="p-4 text-center text-gray-400 text-[var(--font-size-sm)]">
                    {t('fileManager.noSubfolders')}
                  </div>
                ) : (
                  copyMoveBrowseFiles.map((dir) => (
                    <button
                      key={dir.path}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left border-b border-border last:border-0"
                      onClick={() => loadCopyMoveBrowse(dir.path)}
                    >
                      <Folder size={16} className="text-[#faad14]" />
                      <span className="flex-1">{dir.name}</span>
                      <ChevronRight size={14} className="text-gray-400" />
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[var(--font-size-sm)] text-gray-500">
                {t('fileManager.localPCDesc')}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-[var(--font-size-sm)] bg-gray-50 border border-border rounded-[var(--border-radius)] px-3 py-2 truncate">
                  {copyMoveLocalPath || t('fileManager.selectLocalFolder')}
                </div>
                <Button variant="outline" size="sm" onClick={selectLocalPath}>
                  <FolderOpen size={14} />
                  {t('common.browse')}
                </Button>
              </div>
              <div className="text-[var(--font-size-xs)] text-gray-400">
                {t('fileManager.localPCHint')}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyMoveVisible(false)}>
              {t('common.cancel')}
            </Button>
            {copyMoveTab === 'device' ? (
              <Button variant="primary" onClick={handleCopyMove}>
                {copyMoveOp === 'copy' ? t('fileManager.copyHere') : t('fileManager.moveHere')}
              </Button>
            ) : (
              <Button variant="primary" onClick={handleCopyMoveToLocal} disabled={!copyMoveLocalPath}>
                {copyMoveOp === 'copy' ? t('fileManager.copyHere') : t('fileManager.moveHere')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 搜索对话框 / Search dialog */}
      <Dialog open={searchVisible} onOpenChange={(open) => { setSearchVisible(open); if (!open) { setSearchResults([]); setSearchPattern(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('fileManager.searchFiles')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              icon={Search}
              placeholder={t('fileManager.searchPlaceholder')}
              value={searchPattern}
              onChange={(e) => setSearchPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              autoFocus
            />
            <div className="text-[var(--font-size-xs)] text-gray-400">
              {t('fileManager.searchIn')}: {currentPath}
            </div>
            {searching && <div className="text-center py-4 text-gray-400">{t('common.loading')}</div>}
            {!searching && searchResults.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto border border-border rounded-md">
                {searchResults.map((result) => (
                  <button
                    key={result.path}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left border-b border-border last:border-0"
                    onClick={() => navigateToSearchResult(result)}
                  >
                    {fileIcon(result)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{result.name}</div>
                      <div className="text-[var(--font-size-xs)] text-gray-400 truncate">{result.path}</div>
                    </div>
                    <span className="text-[var(--font-size-xs)] text-gray-400">
                      {result.fileType === 'directory' ? '' : formatFileSize(result.size)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!searching && searchResults.length === 0 && searchPattern && (
              <div className="text-center py-4 text-gray-400">{t('fileManager.noSearchResults')}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSearchVisible(false); setSearchResults([]); setSearchPattern(''); }}>
              {t('common.close')}
            </Button>
            <Button variant="primary" onClick={handleSearch} disabled={!searchPattern.trim() || searching}>
              {t('common.search')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 上下文菜单项组件 / Context menu item component
function CtxItem({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-[var(--font-size-base)] hover:bg-gray-100 transition-colors text-left",
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
