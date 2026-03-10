import React, { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Card,
  Typography,
  message,
  Dropdown,
  Empty,
  Spin,
  Tag,
  Radio,
  Modal,
  Timeline,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ExportOutlined,
  SyncOutlined,
  PhoneOutlined,
  ReloadOutlined,
  HistoryOutlined,
  EyeOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatDuration, callTypeText, callTypeColor } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';

const { Title, Text } = Typography;

interface CallLog {
  id: string;
  number: string;
  contactName?: string;
  type: number; // 1=incoming, 2=outgoing, 3=missed
  date: string;
  duration: number; // seconds
}

interface Version {
  id: string;
  created_at: string;
  action: string;
  description?: string;
  source: string;
  data_before?: string;
  data_after?: string;
}

type CallTypeFilter = 'all' | 'incoming' | 'outgoing' | 'missed';

export const CallLogs: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice } = useStore();
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [typeFilter, setTypeFilter] = useState<CallTypeFilter>('all');
  // 版本历史 / Version history
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [versionHistory, setVersionHistory] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);

  useEffect(() => {
    if (connectedDevice) {
      loadCallLogs();
    }
  }, [connectedDevice]);

  useEffect(() => {
    filterByType();
  }, [typeFilter, callLogs]);

  const loadCallLogs = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<CallLog[]>('get_call_logs', {
        serial: connectedDevice.serial,
      });
      setCallLogs(data || []);
    } catch (error) {
      console.error('Failed to load call logs:', error);
      message.error(t('callLogs.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filterByType = () => {
    if (typeFilter === 'all') {
      setFilteredLogs(callLogs);
      return;
    }
    const typeMap: Record<CallTypeFilter, number> = {
      all: 0,
      incoming: 1,
      outgoing: 2,
      missed: 3,
    };
    const filtered = callLogs.filter((log) => log.type === typeMap[typeFilter]);
    setFilteredLogs(filtered);
  };

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'call_logs',
      });
      message.success(t('callLogs.syncStarted'));
      setTimeout(loadCallLogs, 2000);
    } catch (error) {
      message.error(t('common.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (format: string) => {
    if (!connectedDevice) return;
    setExporting(true);
    try {
      const path = await tauriInvoke<string>('export_call_logs', {
        serial: connectedDevice.serial,
        format,
        outputPath: `call_logs_export_${Date.now()}.${format}`,
      });
      message.success(t('callLogs.exportSuccess', { path }));
    } catch (error) {
      message.error(t('common.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleShowVersionHistory = async () => {
    setVersionModalVisible(true);
    setLoadingVersions(true);
    try {
      const history = await tauriInvoke<Version[]>('get_version_history', {
        dataType: 'call_logs',
      });
      setVersionHistory(history || []);
    } catch (error) {
      message.error(t('versionHistory.loadFailed'));
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleViewVersionDetail = async (versionId: string) => {
    try {
      const detail = await tauriInvoke<any>('get_version_detail', { versionId });
      setSelectedVersionDetail(detail);
      setDetailModalVisible(true);
    } catch (error) {
      message.error(t('versionHistory.loadDetailFailed'));
    }
  };

  const handleRestoreVersion = (versionId: string, description: string) => {
    Modal.confirm({
      title: t('versionHistory.restoreConfirmTitle'),
      content: t('versionHistory.restoreConfirm', { description }),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          message.success(t('versionHistory.restored'));
          loadCallLogs();
        } catch (error) {
          message.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add')) return 'success';
    if (a.includes('update') || a.includes('modify')) return 'processing';
    if (a.includes('delete') || a.includes('remove')) return 'error';
    if (a.includes('restore')) return 'warning';
    return 'default';
  };

  const getCallTypeIcon = (type: number) => {
    const color = callTypeColor(type);
    const rotation =
      type === 1 ? 'rotate(135deg)' : type === 2 ? 'rotate(-45deg)' : 'rotate(0deg)';
    return (
      <PhoneOutlined
        style={{ color, transform: rotation, display: 'inline-block' }}
      />
    );
  };

  const columns: ColumnsType<CallLog> = [
    {
      title: t('callLogs.type'),
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: number) => (
        <Space>
          {getCallTypeIcon(type)}
          <Tag color={callTypeColor(type)}>{callTypeText(type)}</Tag>
        </Space>
      ),
      filters: [
        { text: t('callLogs.incoming'), value: 1 },
        { text: t('callLogs.outgoing'), value: 2 },
        { text: t('callLogs.missed'), value: 3 },
      ],
      onFilter: (value, record) => record.type === value,
    },
    {
      title: t('callLogs.number'),
      dataIndex: 'number',
      key: 'number',
      render: (number) => <Text copyable>{number}</Text>,
    },
    {
      title: t('callLogs.contact'),
      dataIndex: 'contactName',
      key: 'contactName',
      render: (name) => name || <Text type="secondary">{t('callLogs.unknownContact')}</Text>,
    },
    {
      title: t('callLogs.date'),
      dataIndex: 'date',
      key: 'date',
      render: (date) => formatDate(date),
      sorter: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('callLogs.duration'),
      dataIndex: 'duration',
      key: 'duration',
      render: (duration: number) => (
        <Text>{duration > 0 ? formatDuration(duration) : '-'}</Text>
      ),
      sorter: (a, b) => a.duration - b.duration,
    },
  ];

  const exportMenuItems = [
    { key: 'json', label: t('common.jsonFormat') },
    { key: 'csv', label: t('common.csvFormat') },
    { key: 'txt', label: t('common.txtFormat') },
  ];

  if (!connectedDevice) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 20px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size="large">
              <Title level={3}>{t('common.connectDeviceTitle')}</Title>
              <Text type="secondary">{t('callLogs.connectDeviceDesc')}</Text>
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Space
          direction="vertical"
          size="large"
          style={{ width: '100%', marginBottom: 16 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <Title level={2} style={{ margin: 0 }}>
              {t('callLogs.title')}
            </Title>
            <Space wrap>
              <Radio.Group
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="all">{t('callLogs.all')}</Radio.Button>
                <Radio.Button value="incoming">{t('callLogs.incoming')}</Radio.Button>
                <Radio.Button value="outgoing">{t('callLogs.outgoing')}</Radio.Button>
                <Radio.Button value="missed">{t('callLogs.missed')}</Radio.Button>
              </Radio.Group>
              <Dropdown
                menu={{
                  items: exportMenuItems,
                  onClick: ({ key }) => handleExport(key),
                }}
              >
                <Button icon={<ExportOutlined />} loading={exporting}>
                  {t('common.export')}
                </Button>
              </Dropdown>
              <Button
                icon={<HistoryOutlined />}
                onClick={handleShowVersionHistory}
              >
                {t('versionHistory.title')}
              </Button>
              <Button
                icon={<SyncOutlined />}
                loading={syncing}
                onClick={handleSync}
              >
                {t('common.sync')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadCallLogs}>
                {t('common.refresh')}
              </Button>
            </Space>
          </div>
        </Space>

        <Spin spinning={loading}>
          <Table
            columns={columns}
            dataSource={filteredLogs}
            rowKey="id"
            pagination={{
              total: filteredLogs.length,
              pageSize: 20,
              showTotal: (total) => t('common.totalRecords', { total }),
              showSizeChanger: true,
              showQuickJumper: true,
            }}
            locale={{
              emptyText: (
                <Empty
                  description={t('callLogs.noData')}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </Spin>
      </Card>

      {/* 版本历史弹窗 / Version history modal */}
      <Modal
        title={<><HistoryOutlined /> {t('versionHistory.title')} - {t('versionHistory.callLogs')}</>}
        open={versionModalVisible}
        onCancel={() => setVersionModalVisible(false)}
        footer={[<Button key="close" onClick={() => setVersionModalVisible(false)}>{t('common.close')}</Button>]}
        width={700}
      >
        <Spin spinning={loadingVersions}>
          {versionHistory.length === 0 ? (
            <Empty description={t('versionHistory.noVersions')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Timeline
              items={versionHistory.map((v) => ({
                color: getActionColor(v.action),
                children: (
                  <Card size="small" style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <Tag color={getActionColor(v.action)}>{v.action}</Tag>
                        <Text>{v.description}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(v.created_at)}</Text>
                      </Space>
                      <Space size={4}>
                        <Button type="link" size="small" icon={<EyeOutlined />}
                          onClick={() => handleViewVersionDetail(v.id)} />
                        <Button type="link" size="small" icon={<RollbackOutlined />}
                          onClick={() => handleRestoreVersion(v.id, v.description || '')} />
                      </Space>
                    </div>
                  </Card>
                ),
              }))}
            />
          )}
        </Spin>
      </Modal>

      {/* 版本详情弹窗 / Version detail modal */}
      <Modal
        title={t('versionHistory.detail')}
        open={detailModalVisible}
        onCancel={() => { setDetailModalVisible(false); setSelectedVersionDetail(null); }}
        width={800}
        footer={[<Button key="close" onClick={() => { setDetailModalVisible(false); setSelectedVersionDetail(null); }}>{t('common.close')}</Button>]}
      >
        {selectedVersionDetail && (() => {
          const record = selectedVersionDetail.record || selectedVersionDetail;
          const beforeData = record.data_before ? (typeof record.data_before === 'string' ? JSON.parse(record.data_before) : record.data_before) : null;
          const afterData = record.data_after ? (typeof record.data_after === 'string' ? JSON.parse(record.data_after) : record.data_after) : null;
          return (
            <>
              {beforeData && (
                <>
                  <Title level={5}>{t('versionHistory.before')}</Title>
                  <VersionPreview dataType="call_logs" data={beforeData} />
                </>
              )}
              {afterData && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>{t('versionHistory.after')}</Title>
                  <VersionPreview dataType="call_logs" data={afterData} />
                </>
              )}
            </>
          );
        })()}
      </Modal>
    </div>
  );
};
