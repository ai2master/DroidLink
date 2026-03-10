import {
  DashboardOutlined, ContactsOutlined, MessageOutlined, PhoneOutlined,
  FolderOutlined, SyncOutlined, DesktopOutlined, SwapOutlined,
  HistoryOutlined, SettingOutlined, MobileOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';

// 导航项使用 i18n key，渲染时再翻译
// Nav items use i18n keys, translated at render time
const navConfig = [
  { key: 'dashboard', icon: <DashboardOutlined />, labelKey: 'sidebar.dashboard' },
  { section: 'data' },
  { key: 'contacts', icon: <ContactsOutlined />, labelKey: 'sidebar.contacts' },
  { key: 'messages', icon: <MessageOutlined />, labelKey: 'sidebar.messages' },
  { key: 'calllogs', icon: <PhoneOutlined />, labelKey: 'sidebar.callLogs' },
  { section: 'files' },
  { key: 'filemanager', icon: <FolderOutlined />, labelKey: 'sidebar.fileManager' },
  { key: 'foldersync', icon: <SyncOutlined />, labelKey: 'sidebar.folderSync' },
  { section: 'tools' },
  { key: 'screenmirror', icon: <DesktopOutlined />, labelKey: 'sidebar.screenMirror' },
  { key: 'transfer', icon: <SwapOutlined />, labelKey: 'sidebar.transfer' },
  { key: 'versionhistory', icon: <HistoryOutlined />, labelKey: 'sidebar.versionHistory' },
  { section: '' },
  { key: 'settings', icon: <SettingOutlined />, labelKey: 'sidebar.settings' },
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
            <MobileOutlined />
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
