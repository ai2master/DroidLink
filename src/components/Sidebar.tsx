import {
  LayoutDashboard, Users, MessageSquare, Phone,
  Folder, RefreshCw, Monitor, ArrowLeftRight,
  History, Settings, Smartphone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';

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

  return (
    <div className="app-sidebar">
      <div className="app-sidebar-header">
        <div className="app-sidebar-logo">
          <div className="logo-icon">
            <Smartphone />
          </div>
          <h1>DroidLink</h1>
        </div>
        <div className="device-status">
          <span className={`status-dot ${device ? 'connected' : ''}`} />
          {device ? (
            <span className="device-name">{device.displayName || device.model}</span>
          ) : (
            <span>{t('common.connectDevice')}</span>
          )}
        </div>
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
