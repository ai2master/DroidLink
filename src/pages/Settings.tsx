import React, { useEffect, useState } from 'react';
import {
  Settings as SettingIcon,
  CheckCircle2,
  XCircle,
  Save,
  Globe,
  Wrench,
  FolderOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../i18n';
import { tauriInvoke } from '../utils/tauri';
import { getVersion } from '@tauri-apps/api/app';
import { useStore } from '../stores/useStore';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { useToast } from '../components/ui/toast';
import { cn } from '../utils/cn';

interface SettingsData {
  autoSync: boolean;
  syncContacts: boolean;
  syncMessages: boolean;
  syncCallLogs: boolean;
  retentionDays: number;
  clipboardSync: boolean;
  scrcpyMaxSize: number;
  scrcpyBitRate: number;
}

// ADB 路径信息 / ADB path info
interface AdbInfo {
  adb_path: string;
  is_bundled: boolean;
  port: number;
  reused_server: boolean;
  version: string;
  source: string;
}

interface ToolSources {
  adb: string[];
  scrcpy: string[];
}

interface SystemInfo {
  adbAvailable: boolean;
  adbInfo: AdbInfo | null;
  scrcpyVersion: string | null;
  dataPath: string;
  appVersion: string;
}

export const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const density = useStore((s) => s.density);
  const setDensity = useStore((s) => s.setDensity);

  const [settings, setSettings] = useState<SettingsData>({
    autoSync: false,
    syncContacts: true,
    syncMessages: true,
    syncCallLogs: true,
    retentionDays: 30,
    clipboardSync: false,
    scrcpyMaxSize: 1920,
    scrcpyBitRate: 8000000,
  });
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    adbAvailable: false,
    adbInfo: null,
    scrcpyVersion: null,
    dataPath: '',
    appVersion: '2.0.0',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [toolSources, setToolSources] = useState<ToolSources>({ adb: [], scrcpy: [] });
  const [adbSource, setAdbSource] = useState('bundled');
  const [adbCustomPath, setAdbCustomPath] = useState('');
  const [scrcpySource, setScrcpySource] = useState('bundled');
  const [scrcpyCustomPath, setScrcpyCustomPath] = useState('');

  useEffect(() => {
    loadSettings();
    loadSystemInfo();
    loadToolSources();
    // 从 Tauri 读取真实版本号 / Read real version from Tauri app config
    getVersion().then((v) => {
      setSystemInfo((prev) => ({ ...prev, appVersion: v }));
    }).catch(() => {});
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await tauriInvoke<Record<string, string>>('get_settings');
      // 正确解析 DB snake_case 字符串值为类型化 SettingsData
      // Properly parse DB snake_case string values into typed SettingsData
      setSettings({
        autoSync: data.auto_sync === 'true',
        syncContacts: data.sync_contacts !== 'false',
        syncMessages: data.sync_messages !== 'false',
        syncCallLogs: data.sync_call_logs !== 'false',
        retentionDays: parseInt(data.version_history_days) || 30,
        clipboardSync: data.clipboard_sync !== 'false',
        scrcpyMaxSize: parseInt(data.scrcpy_max_size) || 1920,
        scrcpyBitRate: parseInt(data.scrcpy_bit_rate) || 8000000,
      });
      // 读取工具路径设置 / Load tool path settings
      if (data.adb_source) setAdbSource(data.adb_source);
      if (data.adb_custom_path) setAdbCustomPath(data.adb_custom_path);
      if (data.scrcpy_source) setScrcpySource(data.scrcpy_source);
      if (data.scrcpy_custom_path) setScrcpyCustomPath(data.scrcpy_custom_path);
    } catch (error) {
      console.error('Failed to load settings:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const loadToolSources = async () => {
    try {
      const sources = await tauriInvoke<ToolSources>('get_tool_sources');
      setToolSources(sources);
    } catch (error) {
      console.error('Failed to load tool sources:', error);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const [adb, scrcpy, dataPath, adbInfo] = await Promise.all([
        tauriInvoke<boolean>('check_adb').catch(() => false),
        tauriInvoke<string>('check_scrcpy').catch(() => null),
        tauriInvoke<string>('get_data_path').catch(() => ''),
        tauriInvoke<AdbInfo>('get_adb_info').catch(() => null),
      ]);
      setSystemInfo((prev) => ({
        ...prev,
        adbAvailable: adb,
        adbInfo: adbInfo,
        scrcpyVersion: scrcpy || null,
        dataPath: dataPath || '',
      }));
    } catch (error) {
      console.error('Failed to load system info:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 转换 camelCase 为 snake_case DB 键，不包含工具路径设置（由 update_tool_paths 处理）
      // Convert camelCase to snake_case DB keys, excluding tool paths (handled by update_tool_paths)
      await tauriInvoke('set_settings', {
        settings: {
          auto_sync: String(settings.autoSync),
          sync_contacts: String(settings.syncContacts),
          sync_messages: String(settings.syncMessages),
          sync_call_logs: String(settings.syncCallLogs),
          version_history_days: String(settings.retentionDays),
          clipboard_sync: String(settings.clipboardSync),
          scrcpy_max_size: String(settings.scrcpyMaxSize),
          scrcpy_bit_rate: String(settings.scrcpyBitRate),
        },
      });

      // 更新工具路径（单独保存，避免覆盖） / Update tool paths (separate save to avoid conflicts)
      await tauriInvoke('update_tool_paths', {
        adbSource,
        adbCustomPath: adbCustomPath || null,
        scrcpySource,
        scrcpyCustomPath: scrcpyCustomPath || null,
      });

      // 刷新 ADB 信息 / Refresh ADB info
      await loadSystemInfo();

      setChanged(false);
      toast.success(t('common.success'));
    } catch (error) {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleValidatePath = async (tool: string, path: string) => {
    if (!path) return;
    try {
      const valid = await tauriInvoke<boolean>('validate_tool_path', { tool, path });
      if (valid) {
        toast.success(t('settings.pathValid'));
      } else {
        toast.warning(t('settings.invalidToolPath'));
      }
    } catch (error) {
      toast.error(t('settings.invalidToolPath'));
    }
  };

  // 切换语言 / Switch language
  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const renderStatusBadge = (available: boolean) => {
    return available ? (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-success"></span>
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span>{t('common.yes')}</span>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-error"></span>
        <div className="flex items-center gap-1">
          <XCircle className="h-4 w-4 text-error" />
          <span>{t('common.no')}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-[var(--page-padding)] relative">
      {loading && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-[var(--font-size-title)] font-semibold flex items-center gap-2 m-0">
              <SettingIcon className="h-6 w-6" /> {t('settings.title')}
            </h2>
            {changed && (
              <Button variant="primary" loading={saving} onClick={handleSave}>
                <Save className="h-4 w-4 mr-2" />
                {t('common.save')}
              </Button>
            )}
          </div>

          {/* 语言设置 / Language settings */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3 flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('common.language')}
            </div>
            <Select value={i18n.language?.split('-')[0] || 'zh'} onValueChange={changeLanguage}>
              <SelectTrigger className="w-[300px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedLanguages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.nativeName} ({lang.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 显示密度设置 / Display density settings */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">
              {t('settings.displayDensity')}
            </div>
            <RadioGroup value={density} onValueChange={(val) => setDensity(val as 'compact' | 'comfortable')}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="compact" id="density-compact" />
                  <label htmlFor="density-compact" className="text-[var(--font-size-sm)] cursor-pointer">
                    {t('settings.densityCompact')}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="comfortable" id="density-comfortable" />
                  <label htmlFor="density-comfortable" className="text-[var(--font-size-sm)] cursor-pointer">
                    {t('settings.densityComfortable')}
                  </label>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* 同步设置 / Sync settings */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('settings.syncInterval')}</div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('settings.autoSync')}</label>
                <Switch
                  checked={settings.autoSync}
                  onCheckedChange={(checked) => {
                    setSettings((prev) => ({ ...prev, autoSync: checked }));
                    setChanged(true);
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('contacts.title')}</label>
                <Switch
                  checked={settings.syncContacts}
                  onCheckedChange={(checked) => {
                    setSettings((prev) => ({ ...prev, syncContacts: checked }));
                    setChanged(true);
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('messages.title')}</label>
                <Switch
                  checked={settings.syncMessages}
                  onCheckedChange={(checked) => {
                    setSettings((prev) => ({ ...prev, syncMessages: checked }));
                    setChanged(true);
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('callLogs.title')}</label>
                <Switch
                  checked={settings.syncCallLogs}
                  onCheckedChange={(checked) => {
                    setSettings((prev) => ({ ...prev, syncCallLogs: checked }));
                    setChanged(true);
                  }}
                />
              </div>
            </div>
          </div>

          {/* 版本历史 / Version history */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('versionHistory.title')}</div>
            <div className="flex items-center justify-between py-2">
              <label className="text-[var(--font-size-sm)]">{t('folderSync.retentionDays')}</label>
              <Input
                type="number"
                min={7}
                max={365}
                value={settings.retentionDays}
                onChange={(e) => {
                  setSettings((prev) => ({ ...prev, retentionDays: parseInt(e.target.value) || 30 }));
                  setChanged(true);
                }}
                className="w-32"
              />
            </div>
          </div>

          {/* scrcpy 设置 / scrcpy settings */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">scrcpy</div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('screenMirror.maxResolution')}</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={720}
                    max={2560}
                    step={10}
                    value={settings.scrcpyMaxSize}
                    onChange={(e) => {
                      setSettings((prev) => ({ ...prev, scrcpyMaxSize: parseInt(e.target.value) || 1920 }));
                      setChanged(true);
                    }}
                    className="w-32"
                  />
                  <span className="text-[var(--font-size-sm)] text-gray-500">px</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <label className="text-[var(--font-size-sm)]">{t('screenMirror.bitRate')}</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={settings.scrcpyBitRate / 1000000}
                    onChange={(e) => {
                      setSettings((prev) => ({ ...prev, scrcpyBitRate: (parseFloat(e.target.value) || 8) * 1000000 }));
                      setChanged(true);
                    }}
                    className="w-32"
                  />
                  <span className="text-[var(--font-size-sm)] text-gray-500">Mbps</span>
                </div>
              </div>
            </div>
          </div>

          {/* 工具路径配置 / Tool paths configuration */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3 flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              {t('settings.toolPaths')}
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <span className="font-semibold text-[var(--font-size-sm)] block mb-2">{t('settings.adbSource')}</span>
                <RadioGroup
                  value={adbSource}
                  onValueChange={(val) => {
                    setAdbSource(val);
                    setChanged(true);
                  }}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem
                        value="bundled"
                        id="adb-bundled"
                        disabled={!toolSources.adb.includes('bundled')}
                      />
                      <div className="flex flex-col">
                        <label htmlFor="adb-bundled" className="text-[var(--font-size-sm)] cursor-pointer">
                          {t('settings.bundledAdb')}
                        </label>
                        <span className="text-gray-500 text-[var(--font-size-xs)]">
                          {t('settings.bundledAdbDesc')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem
                        value="system"
                        id="adb-system"
                        disabled={!toolSources.adb.includes('system')}
                      />
                      <div className="flex flex-col">
                        <label htmlFor="adb-system" className="text-[var(--font-size-sm)] cursor-pointer">
                          {t('settings.systemAdb')}
                        </label>
                        <span className="text-gray-500 text-[var(--font-size-xs)]">
                          {t('settings.systemAdbDesc')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="custom" id="adb-custom" />
                      <label htmlFor="adb-custom" className="text-[var(--font-size-sm)] cursor-pointer">
                        {t('settings.customAdb')}
                      </label>
                    </div>
                  </div>
                </RadioGroup>
                {adbSource === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={adbCustomPath}
                      onChange={(e) => {
                        setAdbCustomPath(e.target.value);
                        setChanged(true);
                      }}
                      placeholder={t('settings.adbCustomPath')}
                      className="flex-1"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleValidatePath('adb', adbCustomPath)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('settings.validatePath')}</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>

              <hr className="border-border my-2" />

              <div>
                <span className="font-semibold text-[var(--font-size-sm)] block mb-2">{t('settings.scrcpySource')}</span>
                <RadioGroup
                  value={scrcpySource}
                  onValueChange={(val) => {
                    setScrcpySource(val);
                    setChanged(true);
                  }}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem
                        value="bundled"
                        id="scrcpy-bundled"
                        disabled={!toolSources.scrcpy.includes('bundled')}
                      />
                      <div className="flex flex-col">
                        <label htmlFor="scrcpy-bundled" className="text-[var(--font-size-sm)] cursor-pointer">
                          {t('settings.bundledScrcpy')}
                        </label>
                        <span className="text-gray-500 text-[var(--font-size-xs)]">
                          {t('settings.bundledScrcpyDesc')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem
                        value="system"
                        id="scrcpy-system"
                        disabled={!toolSources.scrcpy.includes('system')}
                      />
                      <label htmlFor="scrcpy-system" className="text-[var(--font-size-sm)] cursor-pointer">
                        {t('settings.systemScrcpy')}
                      </label>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="custom" id="scrcpy-custom" />
                      <label htmlFor="scrcpy-custom" className="text-[var(--font-size-sm)] cursor-pointer">
                        {t('settings.customScrcpy')}
                      </label>
                    </div>
                  </div>
                </RadioGroup>
                {scrcpySource === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={scrcpyCustomPath}
                      onChange={(e) => {
                        setScrcpyCustomPath(e.target.value);
                        setChanged(true);
                      }}
                      placeholder={t('settings.scrcpyCustomPath')}
                      className="flex-1"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleValidatePath('scrcpy', scrcpyCustomPath)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('settings.validatePath')}</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ADB 信息 / ADB info */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('settings.adbInfo')}</div>
            <dl className="grid grid-cols-1 gap-3">
              <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                <dt className="text-[var(--font-size-sm)] text-gray-600">{t('common.status')}</dt>
                <dd>{renderStatusBadge(systemInfo.adbAvailable)}</dd>
              </div>
              {systemInfo.adbInfo && (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.adbPath')}</dt>
                    <dd>
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[var(--font-size-xs)]">
                        {systemInfo.adbInfo.adb_path}
                      </code>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.adbPort')}</dt>
                    <dd>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-700">
                        {systemInfo.adbInfo.port}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.adbSource')}</dt>
                    <dd>
                      {systemInfo.adbInfo.source === 'bundled' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                          {t('settings.bundled')}
                        </span>
                      )}
                      {systemInfo.adbInfo.source === 'system' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                          {t('settings.system')}
                        </span>
                      )}
                      {systemInfo.adbInfo.source === 'custom' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700">
                          {t('settings.custom')}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.adbReused')}</dt>
                    <dd>
                      {systemInfo.adbInfo.reused_server ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                          {t('common.yes')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-700">
                          {t('common.no')}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.adbVersion')}</dt>
                    <dd>
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[var(--font-size-xs)]">
                        {systemInfo.adbInfo.version}
                      </code>
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          {/* 关于 / About */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('settings.about')}</div>
            <dl className="grid grid-cols-1 gap-3 mb-4">
              <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                <dt className="text-[var(--font-size-sm)] text-gray-600">scrcpy</dt>
                <dd>
                  {systemInfo.scrcpyVersion ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                        {systemInfo.scrcpyVersion}
                      </span>
                      {renderStatusBadge(true)}
                    </div>
                  ) : (
                    renderStatusBadge(false)
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.dataPath')}</dt>
                <dd>
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[var(--font-size-xs)]">
                    {systemInfo.dataPath}
                  </code>
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                <dt className="text-[var(--font-size-sm)] text-gray-600">{t('settings.version')}</dt>
                <dd>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                    v{systemInfo.appVersion}
                  </span>
                </dd>
              </div>
            </dl>
            <hr className="border-border my-4" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[var(--font-size-base)]">DroidLink</span>
              <span className="text-gray-500 text-[var(--font-size-sm)]">{t('app.subtitle')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
