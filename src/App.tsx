import { useEffect, useState } from 'react';
import { useStore } from './stores/useStore';
import { tauriInvoke, tauriListen } from './utils/tauri';
import { ErrorBoundary } from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CompanionInstallPrompt from './components/CompanionInstallPrompt';
import { Dashboard } from './pages/Dashboard';
import { Contacts } from './pages/Contacts';
import { Messages } from './pages/Messages';
import { CallLogs } from './pages/CallLogs';
import FileManager from './pages/FileManager';
import FolderSync from './pages/FolderSync';
import ScreenMirror from './pages/ScreenMirror';
import Transfer from './pages/Transfer';
import { VersionHistory } from './pages/VersionHistory';
import { Settings } from './pages/Settings';
import Terminal from './pages/Terminal';

function App() {
  const currentPage = useStore((s) => s.currentPage);
  const addDevice = useStore((s) => s.addDevice);
  const removeDevice = useStore((s) => s.removeDevice);
  const setCompanionInstalled = useStore((s) => s.setCompanionInstalled);
  const setCompanionStatus = useStore((s) => s.setCompanionStatus);
  const updateSyncStatus = useStore((s) => s.updateSyncStatus);
  const setClipboardContent = useStore((s) => s.setClipboardContent);
  const setSettings = useStore((s) => s.setSettings);
  const connectedDevice = useStore((s) => s.connectedDevice);
  const showCompanionPrompt = useStore((s) => s.showCompanionPrompt);
  const setShowCompanionPrompt = useStore((s) => s.setShowCompanionPrompt);

  // Companion app 安装提示状态
  // Companion app install prompt state
  const [companionPromptVisible, setCompanionPromptVisible] = useState(false);
  const [companionDeviceSerial, setCompanionDeviceSerial] = useState('');
  const [companionDeviceName, setCompanionDeviceName] = useState('');
  const [companionPromptMode, setCompanionPromptMode] = useState<'install' | 'update'>('install');

  useEffect(() => {
    // Load initial settings
    tauriInvoke<Record<string, string>>('get_settings').then(setSettings).catch(console.error);

    // 启动时检查所有已连接设备 / Check all already connected devices on startup
    tauriInvoke<Array<{ serial: string; state: string }>>('get_devices')
      .then(async (devices) => {
        const connected = devices.filter((d) => d.state === 'device');
        for (const dev of connected) {
          try {
            const info = await tauriInvoke('get_device_info', { serial: dev.serial });
            addDevice(info as any);
          } catch (e) {
            console.error(`Failed to get device info for ${dev.serial}:`, e);
          }
        }
      })
      .catch(console.error);

    // 监听设备连接事件 / Listen for device connect events
    const unlistenConnect = tauriListen('device-connected', (device: any) => {
      addDevice(device);
    });

    // 监听设备断开事件 / Listen for device disconnect events
    const unlistenDisconnect = tauriListen('device-disconnected', (data: any) => {
      const serial = typeof data === 'string' ? data : data?.serial;
      if (serial) {
        removeDevice(serial);
      }
      setCompanionPromptVisible(false);
    });

    // =====================================================================
    // 监听 Companion 状态事件 / Listen for Companion Status Event
    // =====================================================================
    //
    // 后端 (lib.rs) 在设备连接时自动检查 Companion 状态，
    // 通过 "companion-status" Tauri 事件通知前端。
    // Backend (lib.rs) auto-checks Companion status on device connect,
    // notifies frontend via "companion-status" Tauri event.
    //
    // 事件数据格式 / Event data format:
    //   {
    //     serial: string,               // 设备序列号 / device serial
    //     installed: boolean,            // 是否已安装 / whether installed
    //     deviceVersion: string,         // 设备上的版本 / version on device
    //     bundledVersion: string,        // Desktop 内置版本 / bundled version
    //     needsUpdate: boolean,          // 是否需要更新 / whether update needed
    //     protocolVersion: number,       // Desktop 协议版本 / Desktop protocol version
    //     deviceProtocolVersion: number|null  // 设备协议版本 / device protocol version
    //   }
    //
    // 前端行为 / Frontend behavior:
    //   installed=false → 弹出安装提示 / show install prompt
    //   needsUpdate=true → 弹出更新提示 / show update prompt
    //   否则 → 无操作 / otherwise → no action
    const unlistenCompanion = tauriListen('companion-status', (status: any) => {
      if (status) {
        // 将后端数据写入 zustand store (按设备序列号存储)
        // Write backend data to zustand store (stored per device serial)
        setCompanionStatus(status.serial || '', {
          installed: !!status.installed,
          deviceVersion: status.deviceVersion || '',
          bundledVersion: status.bundledVersion || '',
          needsUpdate: !!status.needsUpdate,
          protocolVersion: status.protocolVersion ?? undefined,
          deviceProtocolVersion: status.deviceProtocolVersion ?? null,
        });

        // 显示安装/更新弹窗 / Show install/update prompt dialog
        const showPrompt = (mode: 'install' | 'update') => {
          setCompanionDeviceSerial(status.serial || '');
          setCompanionPromptMode(mode);
          // 获取设备名称用于弹窗显示 / Get device name for prompt display
          tauriInvoke<any>('get_device_info', { serial: status.serial })
            .then((info: any) => {
              setCompanionDeviceName(info?.displayName || info?.model || status.serial);
              setCompanionPromptVisible(true);
            })
            .catch(() => {
              setCompanionDeviceName(status.serial);
              setCompanionPromptVisible(true);
            });
        };

        if (!status.installed) {
          // Companion 未安装 → 提示用户安装
          // Companion not installed → prompt user to install
          showPrompt('install');
        } else if (status.needsUpdate) {
          // 协议不兼容 → 提示用户更新
          // Protocol incompatible → prompt user to update
          showPrompt('update');
        }
        // 协议兼容 → 不弹窗，Dashboard 显示 "协议兼容，无需更新"
        // Protocol compatible → no prompt, Dashboard shows "Protocol compatible, no update needed"
      }
    });

    const unlistenSyncStatus = tauriListen('sync-status', (status: any) => {
      updateSyncStatus(status);
    });

    const unlistenSyncProgress = tauriListen('sync-progress', (progress: any) => {
      updateSyncStatus({ type: 'progress', ...progress });
    });

    const unlistenClipboard = tauriListen('clipboard-changed', (data: any) => {
      setClipboardContent(data.text || '');
    });

    return () => {
      unlistenConnect.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenCompanion.then((fn) => fn());
      unlistenSyncStatus.then((fn) => fn());
      unlistenSyncProgress.then((fn) => fn());
      unlistenClipboard.then((fn) => fn());
    };
  }, []);

  // When a page requests companion install, show the prompt
  useEffect(() => {
    if (showCompanionPrompt && connectedDevice) {
      setCompanionDeviceSerial(connectedDevice.serial);
      setCompanionDeviceName(connectedDevice.displayName || connectedDevice.model);
      setCompanionPromptMode('install');
      setCompanionPromptVisible(true);
      setShowCompanionPrompt(false);
    }
  }, [showCompanionPrompt]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'contacts': return <Contacts />;
      case 'messages': return <Messages />;
      case 'calllogs': return <CallLogs />;
      case 'filemanager': return <FileManager />;
      case 'foldersync': return <FolderSync />;
      case 'screenmirror': return <ScreenMirror />;
      case 'transfer': return <Transfer />;
      case 'terminal': return <Terminal />;
      case 'versionhistory': return <VersionHistory />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        <div className="app-page-scroll">
          <ErrorBoundary key={currentPage}>
            {renderPage()}
          </ErrorBoundary>
        </div>
        <StatusBar />
      </div>

      {/* Companion App 安装/更新提示 - 仅在用户同意后才安装 */}
      {/* Companion App install/update prompt - installs ONLY after user consent */}
      <CompanionInstallPrompt
        visible={companionPromptVisible}
        serial={companionDeviceSerial}
        deviceName={companionDeviceName}
        mode={companionPromptMode}
        onClose={() => setCompanionPromptVisible(false)}
        onInstalled={() => { setCompanionInstalled(true); setCompanionPromptVisible(false); }}
      />
    </div>
  );
}

export default App;
