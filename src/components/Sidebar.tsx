import {
  LayoutDashboard, Users, MessageSquare, Phone,
  Folder, RefreshCw, Monitor, ArrowLeftRight,
  History, Settings, Smartphone, ChevronDown, Check,
  TerminalSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

// 导航项使用 i18n key，渲染时再翻译
// Nav items use i18n keys, translated at render time
const navConfig = [
  { key: 'dashboard', icon: <LayoutDashboard />, labelKey: 'sidebar.dashboard' },
  { section: 'data' },
  { key: 'contacts', icon: <Users />, labelKey: 'sidebar.contacts' },
  { key: 'messages', icon: <MessageSquare />, labelKey: 'sidebar.messages' },
  { key: 'calllogs', icon: <Phone />, labelKey: 'sidebar.callLogs' },
  { section: 'files' },
  { key: 'filemanager', icon: <Folder />, labelKey: 'sidebar.fileManager' },
  { key: 'foldersync', icon: <RefreshCw />, labelKey: 'sidebar.folderSync' },
  { section: 'tools' },
  { key: 'screenmirror', icon: <Monitor />, labelKey: 'sidebar.screenMirror' },
  { key: 'terminal', icon: <TerminalSquare />, labelKey: 'sidebar.terminal' },
  { key: 'transfer', icon: <ArrowLeftRight />, labelKey: 'sidebar.transfer' },
  { key: 'versionhistory', icon: <History />, labelKey: 'sidebar.versionHistory' },
  { section: '' },
  { key: 'settings', icon: <Settings />, labelKey: 'sidebar.settings' },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const device = useStore((s) => s.connectedDevice);
  const connectedDevices = useStore((s) => s.connectedDevices);
  const activeDeviceSerial = useStore((s) => s.activeDeviceSerial);
  const setActiveDevice = useStore((s) => s.setActiveDevice);

  const deviceCount = connectedDevices.length;

  // 截取序列号显示 / Truncate serial for display
  const truncateSerial = (serial: string) =>
    serial.length > 12 ? serial.slice(0, 6) + '...' + serial.slice(-4) : serial;

  return (
    <div className="app-sidebar">
      <div className="app-sidebar-header">
        <div className="app-sidebar-logo">
          <div className="logo-icon">
            <Smartphone />
          </div>
          <h1>DroidLink</h1>
        </div>

        {/* 设备选择器 / Device selector */}
        {deviceCount <= 1 ? (
          // 单设备或无设备：显示简单状态 / Single or no device: simple status
          <div className="device-status">
            <span className={`status-dot ${device ? 'connected' : ''}`} />
            {device ? (
              <span className="device-name">{device.displayName || device.model}</span>
            ) : (
              <span>{t('common.connectDevice')}</span>
            )}
          </div>
        ) : (
          // 多设备：显示下拉选择器 / Multiple devices: dropdown selector
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="device-status device-selector-trigger">
                <span className="status-dot connected" />
                <span className="device-name" style={{ flex: 1, textAlign: 'left' }}>
                  {device?.displayName || device?.model || t('sidebar.selectDevice')}
                </span>
                <span className="device-count-badge">{deviceCount}</span>
                <ChevronDown className="device-chevron" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" style={{ minWidth: 220 }}>
              <div style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)', color: '#888' }}>
                {t('sidebar.devicesConnected', { count: deviceCount })}
              </div>
              <DropdownMenuSeparator />
              {connectedDevices.map((dev) => (
                <DropdownMenuItem
                  key={dev.serial}
                  onClick={() => setActiveDevice(dev.serial)}
                  className="device-selector-item"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <Smartphone style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: dev.serial === activeDeviceSerial ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {dev.displayName || dev.model}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: '#888' }}>
                        {dev.manufacturer} &middot; {truncateSerial(dev.serial)}
                      </div>
                    </div>
                    {dev.serial === activeDeviceSerial && (
                      <Check style={{ width: 14, height: 14, color: 'var(--primary)', flexShrink: 0 }} />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <nav className="app-sidebar-nav">
        {navConfig.map((item, i) => {
          if ('section' in item && !('key' in item)) {
            return item.section ? (
              <div key={i} className="nav-section-title">{item.section}</div>
            ) : <div key={i} style={{ height: 8 }} />;
          }
          const navItem = item as { key: string; icon: React.ReactNode; labelKey: string };
          return (
            <div
              key={navItem.key}
              className={`nav-item ${currentPage === navItem.key ? 'active' : ''}`}
              onClick={() => setCurrentPage(navItem.key)}
            >
              <span className="nav-icon">{navItem.icon}</span>
              <span>{t(navItem.labelKey)}</span>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
