import { useEffect, useState } from 'react';
import { useStore } from './stores/useStore';
import { tauriInvoke, tauriListen } from './utils/tauri';
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

function App() {
  const currentPage = useStore((s) => s.currentPage);
  const setConnectedDevice = useStore((s) => s.setConnectedDevice);
  const setCompanionInstalled = useStore((s) => s.setCompanionInstalled);
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

  useEffect(() => {
    // Load initial settings
    tauriInvoke<Record<string, string>>('get_settings').then(setSettings).catch(console.error);

    // Check for already connected devices
    tauriInvoke<Array<{ serial: string; state: string }>>('get_devices')
      .then(async (devices) => {
        const connected = devices.find((d) => d.state === 'device');
        if (connected) {
          const info = await tauriInvoke('get_device_info', { serial: connected.serial });
          setConnectedDevice(info as any);
        }
      })
      .catch(console.error);

    // Listen for device events
    const unlistenConnect = tauriListen('device-connected', (device: any) => {
      setConnectedDevice(device);
    });

    const unlistenDisconnect = tauriListen('device-disconnected', () => {
      setConnectedDevice(null);
      setCompanionPromptVisible(false);
    });

    // 监听 companion 状态事件 - 设备连接后后端自动检查并通知
    // Listen for companion status event - backend checks after device connects
    const unlistenCompanion = tauriListen('companion-status', (status: any) => {
      if (status) {
        setCompanionInstalled(!!status.installed);
        if (!status.installed) {
          // Companion 未安装，弹出安装提示（需要用户同意才安装）
          // Companion not installed, show install prompt (requires user consent)
          setCompanionDeviceSerial(status.serial || '');
          tauriInvoke<any>('get_device_info', { serial: status.serial })
            .then((info: any) => {
              setCompanionDeviceName(info?.displayName || info?.model || status.serial);
              setCompanionPromptVisible(true);
            })
            .catch(() => {
              setCompanionDeviceName(status.serial);
              setCompanionPromptVisible(true);
            });
        }
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
          {renderPage()}
        </div>
        <StatusBar />
      </div>

      {/* Companion App 安装提示 - 仅在用户同意后才安装 */}
      {/* Companion App install prompt - installs ONLY after user consent */}
      <CompanionInstallPrompt
        visible={companionPromptVisible}
        serial={companionDeviceSerial}
        deviceName={companionDeviceName}
        onClose={() => setCompanionPromptVisible(false)}
        onInstalled={() => { setCompanionInstalled(true); setCompanionPromptVisible(false); }}
      />
    </div>
  );
}

export default App;
