import React, { useEffect, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  Progress,
  Timeline,
  Empty,
  Spin,
  Badge,
  Divider,
  Typography,
  Tag,
  message,
} from 'antd';
import {
  SyncOutlined,
  DesktopOutlined,
  FolderOutlined,
  PhoneOutlined,
  MessageOutlined,
  ContactsOutlined,
  ThunderboltOutlined,
  AndroidOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore, type SyncStatus } from '../stores/useStore';
import { formatFileSize, formatRelativeTime } from '../utils/format';

const { Title, Text } = Typography;

interface Stats {
  contactCount: number;
  messageCount: number;
  callLogCount: number;
}

interface Activity {
  id: string;
  type: string;
  action: string;
  timestamp: string;
  status: 'success' | 'error';
}

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice, syncStatuses } = useStore();
  const [stats, setStats] = useState<Stats>({
    contactCount: 0,
    messageCount: 0,
    callLogCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    if (connectedDevice) {
      loadStats();
      loadActivities();
    }
  }, [connectedDevice]);

  const loadStats = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const [contacts, messages, callLogs] = await Promise.all([
        tauriInvoke<any[]>('get_contacts', { serial: connectedDevice.serial }),
        tauriInvoke<any[]>('get_messages', { serial: connectedDevice.serial }),
        tauriInvoke<any[]>('get_call_logs', { serial: connectedDevice.serial }),
      ]);
      setStats({
        contactCount: contacts?.length || 0,
        messageCount: messages?.length || 0,
        callLogCount: callLogs?.length || 0,
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
      message.error(t('dashboard.loadStatsFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadActivities = async () => {
    // 模拟最近活动 - 实际应用中从后端获取
    // Mock recent activities - in real app, this would come from backend
    const mockActivities: Activity[] = [
      {
        id: '1',
        type: 'contacts',
        action: t('dashboard.syncContacts'),
        timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
        status: 'success',
      },
      {
        id: '2',
        type: 'messages',
        action: t('dashboard.syncMessages'),
        timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
        status: 'success',
      },
      {
        id: '3',
        type: 'call_logs',
        action: t('dashboard.syncCallLogs'),
        timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
        status: 'success',
      },
    ];
    setActivities(mockActivities);
  };

  const handleSyncAll = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', { serial: connectedDevice.serial });
      message.success(t('dashboard.syncAllStarted'));
      setTimeout(() => {
        loadStats();
        loadActivities();
      }, 2000);
    } catch (error) {
      message.error(t('common.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleScreenMirror = () => {
    message.info(t('dashboard.startMirrorMsg'));
  };

  const handleFileManager = () => {
    message.info(t('dashboard.openFileManagerMsg'));
  };

  const getSyncStatusIcon = (status?: string) => {
    switch (status) {
      case 'syncing':
        return <SyncOutlined spin />;
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />;
    }
  };

  const getSyncStatusText = (status?: string) => {
    switch (status) {
      case 'syncing':
        return t('dashboard.syncing');
      case 'success':
        return t('dashboard.syncComplete');
      case 'error':
        return t('dashboard.syncError');
      default:
        return t('dashboard.notSynced');
    }
  };

  if (!connectedDevice) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 20px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size="large">
              <Title level={3}>{t('common.connectDeviceTitle')}</Title>
              <Text type="secondary">{t('dashboard.connectDeviceDesc')}</Text>
            </Space>
          }
        />
      </div>
    );
  }

  const storagePercent = connectedDevice.storageTotal
    ? (connectedDevice.storageUsed / connectedDevice.storageTotal) * 100
    : 0;

  return (
    <Spin spinning={loading}>
      <div style={{ padding: '24px' }}>
        <Title level={2}>{t('dashboard.title')}</Title>

        {/* 设备信息卡片 / Device Info Card */}
        <Card
          style={{ marginBottom: 24 }}
          title={
            <Space>
              <AndroidOutlined style={{ fontSize: 24, color: '#3ddc84' }} />
              <span>{connectedDevice.displayName || connectedDevice.model}</span>
            </Space>
          }
          extra={
            <Badge
              status="success"
              text={t('dashboard.connected')}
              style={{ color: '#52c41a' }}
            />
          }
        >
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <Statistic
                title={t('dashboard.model')}
                value={connectedDevice.model}
                valueStyle={{ fontSize: 16 }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title={t('dashboard.android')}
                value={connectedDevice.androidVersion || 'N/A'}
                valueStyle={{ fontSize: 16 }}
              />
            </Col>
            <Col span={6}>
              <Space>
                <ThunderboltOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                <Statistic
                  title={t('dashboard.battery')}
                  value={connectedDevice.batteryLevel || 0}
                  suffix="%"
                  valueStyle={{ fontSize: 16 }}
                />
              </Space>
            </Col>
            <Col span={6}>
              <Text type="secondary">{t('dashboard.serial')}</Text>
              <div>
                <Text code copyable style={{ fontSize: 12 }}>
                  {connectedDevice.serial}
                </Text>
              </div>
            </Col>
          </Row>

          <Divider />

          <div>
            <div style={{ marginBottom: 8 }}>
              <Space>
                <Text strong>{t('dashboard.storage')}</Text>
                <Text type="secondary">
                  {formatFileSize(connectedDevice.storageUsed)} /{' '}
                  {formatFileSize(connectedDevice.storageTotal)}
                </Text>
              </Space>
            </div>
            <Progress
              percent={Math.round(storagePercent)}
              status={storagePercent > 90 ? 'exception' : 'normal'}
            />
          </div>
        </Card>

        {/* 数据统计卡片 / Stats Cards */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title={t('dashboard.contacts')}
                value={stats.contactCount}
                prefix={<ContactsOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title={t('dashboard.messages')}
                value={stats.messageCount}
                prefix={<MessageOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title={t('dashboard.callLogs')}
                value={stats.callLogCount}
                prefix={<PhoneOutlined />}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
        </Row>

        {/* 快捷操作 / Quick Actions */}
        <Card title={t('dashboard.quickActions')} style={{ marginBottom: 24 }}>
          <Space size="middle" wrap>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              size="large"
              loading={syncing}
              onClick={handleSyncAll}
            >
              {t('dashboard.syncAll')}
            </Button>
            <Button
              icon={<DesktopOutlined />}
              size="large"
              onClick={handleScreenMirror}
            >
              {t('dashboard.startMirror')}
            </Button>
            <Button
              icon={<FolderOutlined />}
              size="large"
              onClick={handleFileManager}
            >
              {t('dashboard.openFileManager')}
            </Button>
          </Space>
        </Card>

        <Row gutter={16}>
          {/* 同步状态 / Sync Status */}
          <Col xs={24} lg={12}>
            <Card title={t('dashboard.syncStatus')} style={{ marginBottom: 24 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {['contacts', 'messages', 'call_logs', 'folders'].map((type) => {
                  const status = syncStatuses?.[type] as (SyncStatus & { status?: string; lastSync?: string }) | undefined;
                  const labelKey = `dashboard.${type === 'call_logs' ? 'callLogs' : type === 'folders' ? 'folderSync' : type}`;
                  return (
                    <div
                      key={type}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Space>
                        {getSyncStatusIcon(status?.status)}
                        <Text strong>{t(labelKey)}</Text>
                      </Space>
                      <Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {status?.lastSync
                            ? formatRelativeTime(status.lastSync)
                            : t('dashboard.neverSynced')}
                        </Text>
                        <Tag color={status?.status === 'success' ? 'success' : 'default'}>
                          {getSyncStatusText(status?.status)}
                        </Tag>
                      </Space>
                    </div>
                  );
                })}
              </Space>
            </Card>
          </Col>

          {/* 最近活动 / Recent Activity */}
          <Col xs={24} lg={12}>
            <Card title={t('dashboard.recentActivity')} style={{ marginBottom: 24 }}>
              {activities.length > 0 ? (
                <Timeline
                  items={activities.map((activity) => ({
                    color: activity.status === 'success' ? 'green' : 'red',
                    children: (
                      <div>
                        <Text strong>{activity.action}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatRelativeTime(activity.timestamp)}
                        </Text>
                      </div>
                    ),
                  }))}
                />
              ) : (
                <Empty description={t('dashboard.noActivity')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      </div>
    </Spin>
  );
};
