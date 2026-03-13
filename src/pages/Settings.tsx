import React, { useEffect, useState } from 'react';
import {
  Card, Form, Switch, InputNumber, Button, Space, Typography, message,
  Divider, Spin, Descriptions, Badge, Tag, Select, Radio, Input, Tooltip,
} from 'antd';
import {
  SettingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SaveOutlined, GlobalOutlined, ToolOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../i18n';
import { tauriInvoke } from '../utils/tauri';
import { getVersion } from '@tauri-apps/api/app';

const { Title, Text } = Typography;

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
  const [form] = Form.useForm();
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
    appVersion: '1.0.0',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [toolSources, setToolSources] = useState<ToolSources>({ adb: [], scrcpy: [] });
  const [adbSource, setAdbSource] = useState('bundled');
  const [adbCustomPath, setAdbCustomPath] = useState('');
  const [scrcpySource, setScrcpySource] = useState('system');
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
      setSettings(data as any);
      form.setFieldsValue(data);
      // 读取工具路径设置 / Load tool path settings
      if (data.adb_source) setAdbSource(data.adb_source);
      if (data.adb_custom_path) setAdbCustomPath(data.adb_custom_path);
      if (data.scrcpy_source) setScrcpySource(data.scrcpy_source);
      if (data.scrcpy_custom_path) setScrcpyCustomPath(data.scrcpy_custom_path);
    } catch (error) {
      console.error('Failed to load settings:', error);
      message.error(t('common.error'));
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
      const values = form.getFieldsValue();
      await tauriInvoke('set_settings', { settings: values });
      setSettings(values);

      // 更新工具路径 / Update tool paths
      await tauriInvoke('update_tool_paths', {
        adbSource,
        adbCustomPath: adbCustomPath || null,
        scrcpySource,
        scrcpyCustomPath: scrcpyCustomPath || null,
      });

      // 刷新 ADB 信息 / Refresh ADB info
      await loadSystemInfo();

      setChanged(false);
      message.success(t('common.success'));
    } catch (error) {
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleValidatePath = async (tool: string, path: string) => {
    if (!path) return;
    try {
      const valid = await tauriInvoke<boolean>('validate_tool_path', { tool, path });
      if (valid) {
        message.success(t('settings.pathValid'));
      } else {
        message.warning(t('settings.invalidToolPath'));
      }
    } catch (error) {
      message.error(t('settings.invalidToolPath'));
    }
  };

  // 切换语言 / Switch language
  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const renderStatusBadge = (available: boolean) => {
    return available ? (
      <Badge status="success" text={
        <Space><CheckCircleOutlined style={{ color: '#52c41a' }} /><Text>{t('common.yes')}</Text></Space>
      } />
    ) : (
      <Badge status="error" text={
        <Space><CloseCircleOutlined style={{ color: '#ff4d4f' }} /><Text>{t('common.no')}</Text></Space>
      } />
    );
  };

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <Title level={2} style={{ margin: 0 }}>
              <SettingOutlined /> {t('settings.title')}
            </Title>
            {changed && (
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                {t('common.save')}
              </Button>
            )}
          </div>

          <Spin spinning={loading}>
            {/* 语言设置 / Language settings */}
            <Card type="inner" title={<><GlobalOutlined style={{ marginRight: 8 }} />{t('common.language')}</>} style={{ marginBottom: 16 }}>
              <Select
                value={i18n.language?.split('-')[0] || 'zh'}
                onChange={changeLanguage}
                style={{ width: 300 }}
                options={supportedLanguages.map((lang) => ({
                  value: lang.code,
                  label: `${lang.nativeName} (${lang.name})`,
                }))}
              />
            </Card>

            <Form form={form} layout="vertical" initialValues={settings} onValuesChange={() => setChanged(true)}>
              {/* 同步设置 / Sync settings */}
              <Card type="inner" title={t('settings.syncInterval')} style={{ marginBottom: 16 }}>
                <Form.Item label={t('settings.autoSync')} name="autoSync" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label={t('contacts.title')} name="syncContacts" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label={t('messages.title')} name="syncMessages" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label={t('callLogs.title')} name="syncCallLogs" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Card>

              {/* 版本历史 / Version history */}
              <Card type="inner" title={t('versionHistory.title')} style={{ marginBottom: 16 }}>
                <Form.Item label={t('folderSync.retentionDays')} name="retentionDays">
                  <InputNumber min={7} max={365} style={{ width: '100%' }} />
                </Form.Item>
              </Card>

              {/* scrcpy 设置 / scrcpy settings */}
              <Card type="inner" title="scrcpy" style={{ marginBottom: 16 }}>
                <Form.Item label={t('screenMirror.maxResolution')} name="scrcpyMaxSize">
                  <InputNumber min={720} max={2560} step={10} style={{ width: '100%' }} addonAfter="px" />
                </Form.Item>
                <Form.Item label={t('screenMirror.bitRate')} name="scrcpyBitRate">
                  <InputNumber
                    min={1000000} max={50000000} step={1000000} style={{ width: '100%' }}
                    formatter={(value) => `${((value || 0) / 1000000).toFixed(1)} Mbps`}
                    parser={(value) => parseFloat(value?.replace(' Mbps', '') || '0') * 1000000 as any}
                  />
                </Form.Item>
              </Card>
            </Form>

            {/* 工具路径配置 / Tool paths configuration */}
            <Card type="inner" title={<><ToolOutlined style={{ marginRight: 8 }} />{t('settings.toolPaths')}</>} style={{ marginBottom: 16 }}>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('settings.adbSource')}</Text>
                  <Radio.Group
                    value={adbSource}
                    onChange={(e) => { setAdbSource(e.target.value); setChanged(true); }}
                  >
                    <Space direction="vertical">
                      <Radio value="bundled" disabled={!toolSources.adb.includes('bundled')}>
                        {t('settings.bundledAdb')}
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          {t('settings.bundledAdbDesc')}
                        </Text>
                      </Radio>
                      <Radio value="system" disabled={!toolSources.adb.includes('system')}>
                        {t('settings.systemAdb')}
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          {t('settings.systemAdbDesc')}
                        </Text>
                      </Radio>
                      <Radio value="custom">
                        {t('settings.customAdb')}
                      </Radio>
                    </Space>
                  </Radio.Group>
                  {adbSource === 'custom' && (
                    <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                      <Input
                        value={adbCustomPath}
                        onChange={(e) => { setAdbCustomPath(e.target.value); setChanged(true); }}
                        placeholder={t('settings.adbCustomPath')}
                        style={{ flex: 1 }}
                      />
                      <Tooltip title={t('settings.validatePath')}>
                        <Button
                          icon={<CheckCircleOutlined />}
                          onClick={() => handleValidatePath('adb', adbCustomPath)}
                        />
                      </Tooltip>
                    </Space.Compact>
                  )}
                </div>

                <Divider style={{ margin: '8px 0' }} />

                <div>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('settings.scrcpySource')}</Text>
                  <Radio.Group
                    value={scrcpySource}
                    onChange={(e) => { setScrcpySource(e.target.value); setChanged(true); }}
                  >
                    <Space direction="vertical">
                      <Radio value="system" disabled={!toolSources.scrcpy.includes('system')}>
                        {t('settings.systemScrcpy')}
                      </Radio>
                      <Radio value="custom">
                        {t('settings.customScrcpy')}
                      </Radio>
                    </Space>
                  </Radio.Group>
                  {scrcpySource === 'custom' && (
                    <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                      <Input
                        value={scrcpyCustomPath}
                        onChange={(e) => { setScrcpyCustomPath(e.target.value); setChanged(true); }}
                        placeholder={t('settings.scrcpyCustomPath')}
                        style={{ flex: 1 }}
                      />
                      <Tooltip title={t('settings.validatePath')}>
                        <Button
                          icon={<CheckCircleOutlined />}
                          onClick={() => handleValidatePath('scrcpy', scrcpyCustomPath)}
                        />
                      </Tooltip>
                    </Space.Compact>
                  )}
                </div>
              </Space>
            </Card>

            {/* ADB 信息 / ADB info */}
            <Card type="inner" title={t('settings.adbInfo')} style={{ marginBottom: 16 }}>
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label={t('common.status')}>
                  {renderStatusBadge(systemInfo.adbAvailable)}
                </Descriptions.Item>
                {systemInfo.adbInfo && (
                  <>
                    <Descriptions.Item label={t('settings.adbPath')}>
                      <Text code copyable>{systemInfo.adbInfo.adb_path}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('settings.adbPort')}>
                      <Tag>{systemInfo.adbInfo.port}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('settings.adbSource')}>
                      {systemInfo.adbInfo.source === 'bundled' && <Tag color="blue">{t('settings.bundled')}</Tag>}
                      {systemInfo.adbInfo.source === 'system' && <Tag color="green">{t('settings.system')}</Tag>}
                      {systemInfo.adbInfo.source === 'custom' && <Tag color="orange">{t('settings.custom')}</Tag>}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('settings.adbReused')}>
                      {systemInfo.adbInfo.reused_server ? <Tag color="green">{t('common.yes')}</Tag> : <Tag>{t('common.no')}</Tag>}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('settings.adbVersion')}>
                      <Text code>{systemInfo.adbInfo.version}</Text>
                    </Descriptions.Item>
                  </>
                )}
              </Descriptions>
            </Card>

            {/* 关于 / About */}
            <Card type="inner" title={t('settings.about')}>
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="scrcpy">
                  {systemInfo.scrcpyVersion ? (
                    <Space><Tag color="success">{systemInfo.scrcpyVersion}</Tag>{renderStatusBadge(true)}</Space>
                  ) : renderStatusBadge(false)}
                </Descriptions.Item>
                <Descriptions.Item label={t('settings.dataPath')}>
                  <Text code copyable>{systemInfo.dataPath}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={t('settings.version')}>
                  <Tag color="blue">v{systemInfo.appVersion}</Tag>
                </Descriptions.Item>
              </Descriptions>
              <Divider />
              <Space direction="vertical">
                <Text strong>DroidLink</Text>
                <Text type="secondary">{t('app.subtitle')}</Text>
              </Space>
            </Card>
          </Spin>
        </Space>
      </Card>
    </div>
  );
};
