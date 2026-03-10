import React, { useEffect, useState } from 'react';
import {
  Table,
  Input,
  Button,
  Space,
  Card,
  Typography,
  message,
  Dropdown,
  Modal,
  Empty,
  Spin,
  Descriptions,
  Timeline,
  Tag,
  Tooltip,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SearchOutlined,
  ExportOutlined,
  SyncOutlined,
  ReloadOutlined,
  DeleteOutlined,
  HistoryOutlined,
  RollbackOutlined,
  EyeOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { VersionDiffView } from '../components/VersionDiffView';

const { Title, Text } = Typography;

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  note?: string;
  lastModified?: string;
}

interface Version {
  id: string;
  timestamp: string;
  action: string;
  changes: string;
  data_before?: string;
  data_after?: string;
}

export const Contacts: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [exporting, setExporting] = useState(false);
  // 版本详情弹窗 / Version detail modal
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);
  // 版本对比弹窗 / Version compare modal
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);

  useEffect(() => {
    if (connectedDevice) {
      loadContacts();
    }
  }, [connectedDevice]);

  useEffect(() => {
    filterContacts();
  }, [searchText, contacts]);

  const loadContacts = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<Contact[]>('get_contacts', {
        serial: connectedDevice.serial,
      });
      setContacts(data || []);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      message.error(t('contacts.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filterContacts = () => {
    if (!searchText.trim()) {
      setFilteredContacts(contacts);
      return;
    }
    const text = searchText.toLowerCase();
    const filtered = contacts.filter(
      (contact) =>
        contact.name?.toLowerCase().includes(text) ||
        contact.phone?.toLowerCase().includes(text) ||
        contact.email?.toLowerCase().includes(text) ||
        contact.company?.toLowerCase().includes(text)
    );
    setFilteredContacts(filtered);
  };

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'contacts',
      });
      message.success(t('contacts.syncStarted'));
      setTimeout(loadContacts, 2000);
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
      const path = await tauriInvoke<string>('export_contacts', {
        serial: connectedDevice.serial,
        format,
        outputPath: `contacts_export_${Date.now()}.${format}`,
      });
      message.success(t('contacts.exportSuccess', { path }));
    } catch (error) {
      message.error(t('common.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (contact: Contact) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('contacts.deleteConfirm', { name: contact.name }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          message.success(t('contacts.deleted'));
          loadContacts();
        } catch (error) {
          message.error(t('common.deleteFailed'));
        }
      },
    });
  };

  const loadVersionHistory = async (contactId: string) => {
    try {
      const history = await tauriInvoke<Version[]>('get_version_history', {
        dataType: 'contacts',
        itemId: contactId,
      });
      setVersions((prev) => ({ ...prev, [contactId]: history || [] }));
    } catch (error) {
      console.error('Failed to load version history:', error);
    }
  };

  const handleExpand = (expanded: boolean, record: Contact) => {
    if (expanded) {
      setExpandedRowKeys([...expandedRowKeys, record.id]);
      loadVersionHistory(record.id);
    } else {
      setExpandedRowKeys(expandedRowKeys.filter((key) => key !== record.id));
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
      content: (
        <div>
          <p>{t('versionHistory.restoreConfirm', { description })}</p>
          <Alert type="info" showIcon message={t('versionHistory.restoreNote')} style={{ marginTop: 8 }} />
        </div>
      ),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          message.success(t('versionHistory.restored'));
          loadContacts();
        } catch (error) {
          message.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const handleCompareWithPrevious = async (contactVersions: Version[], index: number) => {
    if (index + 1 >= contactVersions.length) {
      message.info(t('versionHistory.noPreviousVersion'));
      return;
    }
    try {
      const result = await tauriInvoke<any>('compare_versions', {
        versionIdA: contactVersions[index + 1].id,
        versionIdB: contactVersions[index].id,
      });
      setCompareResult(result);
      setCompareModalVisible(true);
    } catch (error) {
      message.error(t('versionHistory.compareFailed'));
    }
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add') || a.includes('新增') || a.includes('创建')) return 'success';
    if (a.includes('update') || a.includes('modify') || a.includes('修改') || a.includes('更新')) return 'processing';
    if (a.includes('delete') || a.includes('remove') || a.includes('删除')) return 'error';
    if (a.includes('restore') || a.includes('恢复')) return 'warning';
    return 'default';
  };

  const expandedRowRender = (record: Contact) => {
    const contactVersions = versions[record.id] || [];

    return (
      <div style={{ padding: '16px', backgroundColor: '#fafafa' }}>
        <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('contacts.name')}>{record.name}</Descriptions.Item>
          <Descriptions.Item label={t('contacts.phone')}>{record.phone}</Descriptions.Item>
          {record.email && (
            <Descriptions.Item label={t('contacts.email')}>{record.email}</Descriptions.Item>
          )}
          {record.company && (
            <Descriptions.Item label={t('contacts.organization')}>{record.company}</Descriptions.Item>
          )}
          {record.note && (
            <Descriptions.Item label={t('contacts.note')} span={2}>
              {record.note}
            </Descriptions.Item>
          )}
          {record.lastModified && (
            <Descriptions.Item label={t('contacts.lastModified')}>
              {formatDate(record.lastModified)}
            </Descriptions.Item>
          )}
        </Descriptions>

        {contactVersions.length > 0 && (
          <div>
            <Title level={5}>
              <HistoryOutlined /> {t('contacts.versionHistory')}
            </Title>
            <Timeline
              items={contactVersions.map((version, index) => ({
                color: getActionColor(version.action),
                children: (
                  <Card size="small" style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <Tag color={getActionColor(version.action)}>{version.action}</Tag>
                        <Text>{version.changes}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatDate(version.timestamp)}
                        </Text>
                      </Space>
                      <Space size={4}>
                        <Tooltip title={t('versionHistory.viewDetail')}>
                          <Button type="link" size="small" icon={<EyeOutlined />}
                            onClick={() => handleViewVersionDetail(version.id)} />
                        </Tooltip>
                        {index + 1 < contactVersions.length && (
                          <Tooltip title={t('versionHistory.compareWith')}>
                            <Button type="link" size="small" icon={<SwapOutlined />}
                              onClick={() => handleCompareWithPrevious(contactVersions, index)} />
                          </Tooltip>
                        )}
                        <Tooltip title={t('versionHistory.restoreAsNew')}>
                          <Button type="link" size="small" icon={<RollbackOutlined />}
                            onClick={() => handleRestoreVersion(version.id, version.changes)} />
                        </Tooltip>
                      </Space>
                    </div>
                  </Card>
                ),
              }))}
            />
          </div>
        )}

        <Space style={{ marginTop: 16 }}>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            {t('contacts.deleteContact')}
          </Button>
        </Space>
      </div>
    );
  };

  const columns: ColumnsType<Contact> = [
    {
      title: t('contacts.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
      ellipsis: true,
    },
    {
      title: t('contacts.phone'),
      dataIndex: 'phone',
      key: 'phone',
      ellipsis: true,
      render: (phone) => <Text copyable>{phone}</Text>,
    },
    {
      title: t('contacts.email'),
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      render: (email) => email || <Text type="secondary">-</Text>,
    },
    {
      title: t('contacts.organization'),
      dataIndex: 'company',
      key: 'company',
      ellipsis: true,
      render: (company) => company || <Text type="secondary">-</Text>,
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Tooltip title={t('contacts.expandTooltip')}>
          <Button type="link" size="small">
            {t('contacts.detail')}
          </Button>
        </Tooltip>
      ),
    },
  ];

  const exportMenuItems = [
    { key: 'json', label: t('common.jsonFormat') },
    { key: 'csv', label: t('common.csvFormat') },
    { key: 'vcf', label: t('common.vcfFormat') },
  ];

  if (!connectedDevice) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 20px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size="large">
              <Title level={3}>{t('common.connectDeviceTitle')}</Title>
              <Text type="secondary">{t('contacts.connectDeviceDesc')}</Text>
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
              {t('contacts.title')}
            </Title>
            <Space wrap>
              <Input
                placeholder={t('contacts.searchPlaceholder')}
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 300 }}
                allowClear
              />
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
                icon={<SyncOutlined />}
                loading={syncing}
                onClick={handleSync}
              >
                {t('common.sync')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadContacts}>
                {t('common.refresh')}
              </Button>
            </Space>
          </div>
        </Space>

        <Spin spinning={loading}>
          <Table
            columns={columns}
            dataSource={filteredContacts}
            rowKey="id"
            expandable={{
              expandedRowRender,
              expandedRowKeys,
              onExpand: handleExpand,
            }}
            pagination={{
              total: filteredContacts.length,
              pageSize: 20,
              showTotal: (total) => t('common.totalRecords', { total }),
              showSizeChanger: true,
              showQuickJumper: true,
            }}
            locale={{
              emptyText: (
                <Empty
                  description={searchText ? t('contacts.noMatch') : t('contacts.noData')}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </Spin>
      </Card>

      {/* 版本详情弹窗 / Version detail modal */}
      <Modal
        title={t('versionHistory.detail')}
        open={detailModalVisible}
        onCancel={() => { setDetailModalVisible(false); setSelectedVersionDetail(null); }}
        width={800}
        footer={[
          <Button key="close" onClick={() => { setDetailModalVisible(false); setSelectedVersionDetail(null); }}>
            {t('common.close')}
          </Button>,
          selectedVersionDetail && (
            <Button key="restore" type="primary" icon={<RollbackOutlined />}
              onClick={() => {
                handleRestoreVersion(selectedVersionDetail.record?.id || selectedVersionDetail.id, selectedVersionDetail.record?.description || '');
                setDetailModalVisible(false);
                setSelectedVersionDetail(null);
              }}>
              {t('versionHistory.restoreAsNew')}
            </Button>
          ),
        ]}
      >
        {selectedVersionDetail && (() => {
          const record = selectedVersionDetail.record || selectedVersionDetail;
          const beforeData = record.data_before ? (typeof record.data_before === 'string' ? JSON.parse(record.data_before) : record.data_before) : null;
          const afterData = record.data_after ? (typeof record.data_after === 'string' ? JSON.parse(record.data_after) : record.data_after) : null;
          return (
            <>
              <Descriptions bordered column={1} size="small" style={{ marginBottom: 16 }}>
                <Descriptions.Item label={t('versionHistory.operation')}>
                  <Tag color={getActionColor(record.action)}>{record.action}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t('versionHistory.description')}>{record.description}</Descriptions.Item>
                <Descriptions.Item label={t('versionHistory.time')}>{formatDate(record.created_at)}</Descriptions.Item>
              </Descriptions>
              {beforeData && (
                <>
                  <Title level={5}>{t('versionHistory.before')}</Title>
                  <VersionPreview dataType="contacts" data={beforeData} />
                </>
              )}
              {afterData && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>{t('versionHistory.after')}</Title>
                  <VersionPreview dataType="contacts" data={afterData} />
                </>
              )}
            </>
          );
        })()}
      </Modal>

      {/* 版本对比弹窗 / Version compare modal */}
      <Modal
        title={t('versionHistory.compareVersions')}
        open={compareModalVisible}
        onCancel={() => { setCompareModalVisible(false); setCompareResult(null); }}
        width={900}
        footer={[
          <Button key="close" onClick={() => { setCompareModalVisible(false); setCompareResult(null); }}>
            {t('common.close')}
          </Button>,
        ]}
      >
        {compareResult && (
          <VersionDiffView
            dataType={compareResult.versionA.dataType}
            versionA={compareResult.versionA.data}
            versionB={compareResult.versionB.data}
            timestampA={compareResult.versionA.timestamp}
            timestampB={compareResult.versionB.timestamp}
            actionA={compareResult.versionA.action}
            actionB={compareResult.versionB.action}
          />
        )}
      </Modal>
    </div>
  );
};
