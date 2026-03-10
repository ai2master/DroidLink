import React, { useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  Timeline,
  Button,
  Space,
  Typography,
  message,
  Empty,
  Spin,
  Modal,
  DatePicker,
  Descriptions,
  Tag,
  Divider,
  Checkbox,
  Alert,
} from 'antd';
import {
  HistoryOutlined,
  RollbackOutlined,
  DeleteOutlined,
  EyeOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { formatDate } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';
import { VersionDiffView } from '../components/VersionDiffView';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text } = Typography;

interface Version {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  source: string;
  dataType: string;
  itemId?: string;
}

interface VersionDetail {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  before: any;
  after: any;
  changes: string[];
}

interface CompareResult {
  versionA: {
    id: string;
    timestamp: string;
    action: string;
    description: string;
    dataType: string;
    data: any;
  };
  versionB: {
    id: string;
    timestamp: string;
    action: string;
    description: string;
    dataType: string;
    data: any;
  };
}

type DataType = 'contacts' | 'messages' | 'call_logs' | 'folders';

export const VersionHistory: React.FC = () => {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<DataType, Version[]>>({
    contacts: [],
    messages: [],
    call_logs: [],
    folders: [],
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DataType>('contacts');
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [cleanupModalVisible, setCleanupModalVisible] = useState(false);
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(null);
  const [selectedDataType, setSelectedDataType] = useState<string>('contacts');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [beforeDate, setBeforeDate] = useState<Dayjs | null>(null);
  const [cleaning, setCleaning] = useState(false);

  // 对比模式状态 / Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
    loadVersions(activeTab);
  }, [activeTab]);

  const loadVersions = async (dataType: DataType) => {
    setLoading(true);
    try {
      const data = await tauriInvoke<Version[]>('get_version_history', {
        dataType,
      });
      setVersions((prev) => ({ ...prev, [dataType]: data || [] }));
    } catch (error) {
      console.error('Failed to load version history:', error);
      message.error(t('versionHistory.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadVersionDetail = async (versionId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await tauriInvoke<VersionDetail>('get_version_detail', {
        versionId,
      });
      setSelectedVersion(detail);
      setSelectedDataType(activeTab);
      setDetailModalVisible(true);
    } catch (error) {
      console.error('Failed to load version detail:', error);
      message.error(t('versionHistory.loadDetailFailed'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRestore = (versionId: string, description: string) => {
    Modal.confirm({
      title: t('versionHistory.restoreConfirmTitle'),
      content: (
        <div>
          <p>{t('versionHistory.restoreConfirm', { description })}</p>
          <Alert
            type="info"
            showIcon
            message={t('versionHistory.restoreNote')}
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: t('versionHistory.restoreAsNew'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await tauriInvoke('restore_version', { versionId });
          message.success(t('versionHistory.restored'));
          loadVersions(activeTab);
        } catch (error) {
          message.error(t('versionHistory.restoreFailed'));
        }
      },
    });
  };

  const handleCompareToggle = (versionId: string, checked: boolean) => {
    setSelectedForCompare((prev) => {
      if (checked) {
        if (prev.length >= 2) {
          // Replace the oldest selection
          return [prev[1], versionId];
        }
        return [...prev, versionId];
      }
      return prev.filter((id) => id !== versionId);
    });
  };

  const handleCompare = async () => {
    if (selectedForCompare.length !== 2) {
      message.warning(t('versionHistory.selectTwoVersions'));
      return;
    }
    setLoadingCompare(true);
    try {
      const result = await tauriInvoke<CompareResult>('compare_versions', {
        versionIdA: selectedForCompare[0],
        versionIdB: selectedForCompare[1],
      });
      setCompareResult(result);
      setCompareModalVisible(true);
    } catch (error) {
      console.error('Failed to compare versions:', error);
      message.error(t('versionHistory.compareFailed'));
    } finally {
      setLoadingCompare(false);
    }
  };

  const handleCleanup = async () => {
    if (!beforeDate) {
      message.warning(t('versionHistory.selectDate'));
      return;
    }
    setCleaning(true);
    try {
      const count = await tauriInvoke<number>('delete_old_versions', {
        beforeDate: beforeDate.toISOString(),
      });
      message.success(t('versionHistory.cleaned', { count }));
      setCleanupModalVisible(false);
      setBeforeDate(null);
      loadVersions(activeTab);
    } catch (error) {
      message.error(t('versionHistory.cleanFailed'));
    } finally {
      setCleaning(false);
    }
  };

  const getActionColor = (action: string) => {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('create') || actionLower.includes('add') || actionLower.includes('新增') || actionLower.includes('创建')) return 'success';
    if (actionLower.includes('update') || actionLower.includes('modify') || actionLower.includes('修改') || actionLower.includes('更新')) return 'processing';
    if (actionLower.includes('delete') || actionLower.includes('remove') || actionLower.includes('删除')) return 'error';
    if (actionLower.includes('restore') || actionLower.includes('恢复')) return 'warning';
    return 'default';
  };

  const renderTimeline = (versionList: Version[]) => {
    if (versionList.length === 0) {
      return (
        <Empty
          description={t('versionHistory.noVersions')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }

    return (
      <Timeline
        mode="left"
        items={versionList.map((version) => ({
          color: getActionColor(version.action),
          label: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDate(version.timestamp)}
            </Text>
          ),
          children: (
            <Card size="small" style={{ marginBottom: 8 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    {compareMode && (
                      <Checkbox
                        checked={selectedForCompare.includes(version.id)}
                        onChange={(e) => handleCompareToggle(version.id, e.target.checked)}
                      />
                    )}
                    <Tag color={getActionColor(version.action)}>
                      {version.action}
                    </Tag>
                    <Text strong>{version.description}</Text>
                  </Space>
                  <Space>
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => loadVersionDetail(version.id)}
                    >
                      {t('versionHistory.viewDetail')}
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      icon={<RollbackOutlined />}
                      onClick={() => handleRestore(version.id, version.description)}
                    >
                      {t('versionHistory.restore')}
                    </Button>
                  </Space>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('versionHistory.sourcePrefix', { source: version.source })}
                </Text>
              </Space>
            </Card>
          ),
        }))}
      />
    );
  };

  const renderDetailModal = () => {
    if (!selectedVersion) return null;

    // Parse before/after data from the version detail
    const beforeData = selectedVersion.before
      ? (typeof selectedVersion.before === 'string' ? JSON.parse(selectedVersion.before) : selectedVersion.before)
      : null;
    const afterData = selectedVersion.after
      ? (typeof selectedVersion.after === 'string' ? JSON.parse(selectedVersion.after) : selectedVersion.after)
      : null;

    return (
      <Modal
        title={t('versionHistory.detail')}
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false);
          setSelectedVersion(null);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setDetailModalVisible(false);
              setSelectedVersion(null);
            }}
          >
            {t('common.close')}
          </Button>,
          <Button
            key="restore"
            type="primary"
            icon={<RollbackOutlined />}
            onClick={() => {
              handleRestore(selectedVersion.id, selectedVersion.description);
              setDetailModalVisible(false);
              setSelectedVersion(null);
            }}
          >
            {t('versionHistory.restoreAsNew')}
          </Button>,
        ]}
        width={800}
      >
        <Spin spinning={loadingDetail}>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t('versionHistory.operation')}>
              <Tag color={getActionColor(selectedVersion.action)}>
                {selectedVersion.action}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('versionHistory.description')}>
              {selectedVersion.description}
            </Descriptions.Item>
            <Descriptions.Item label={t('versionHistory.time')}>
              {formatDate(selectedVersion.timestamp)}
            </Descriptions.Item>
          </Descriptions>

          {selectedVersion.changes && selectedVersion.changes.length > 0 && (
            <>
              <Divider>{t('versionHistory.changes')}</Divider>
              <Space direction="vertical" style={{ width: '100%' }}>
                {selectedVersion.changes.map((change, index) => (
                  <Text key={index} style={{ fontSize: 13 }}>
                    {change}
                  </Text>
                ))}
              </Space>
            </>
          )}

          {beforeData && (
            <>
              <Divider>{t('versionHistory.before')}</Divider>
              <VersionPreview dataType={selectedDataType} data={beforeData} />
            </>
          )}

          {afterData && (
            <>
              <Divider>{t('versionHistory.after')}</Divider>
              <VersionPreview dataType={selectedDataType} data={afterData} />
            </>
          )}
        </Spin>
      </Modal>
    );
  };

  const renderCompareModal = () => {
    if (!compareResult) return null;

    return (
      <Modal
        title={t('versionHistory.compareVersions')}
        open={compareModalVisible}
        onCancel={() => {
          setCompareModalVisible(false);
          setCompareResult(null);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setCompareModalVisible(false);
              setCompareResult(null);
            }}
          >
            {t('common.close')}
          </Button>,
        ]}
        width={900}
      >
        <VersionDiffView
          dataType={compareResult.versionA.dataType}
          versionA={compareResult.versionA.data}
          versionB={compareResult.versionB.data}
          timestampA={compareResult.versionA.timestamp}
          timestampB={compareResult.versionB.timestamp}
          actionA={compareResult.versionA.action}
          actionB={compareResult.versionB.action}
        />
      </Modal>
    );
  };

  const renderCleanupModal = () => (
    <Modal
      title={t('versionHistory.deleteOld')}
      open={cleanupModalVisible}
      onCancel={() => {
        setCleanupModalVisible(false);
        setBeforeDate(null);
      }}
      onOk={handleCleanup}
      confirmLoading={cleaning}
      okText={t('common.clean')}
      okType="danger"
      cancelText={t('common.cancel')}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Text>{t('versionHistory.cleanupDesc')}</Text>
        <div>
          <Text strong>{t('versionHistory.selectDateLabel')}</Text>
          <DatePicker
            value={beforeDate}
            onChange={setBeforeDate}
            style={{ width: '100%', marginTop: 8 }}
            placeholder={t('versionHistory.datePickerPlaceholder')}
          />
        </div>
        <Text type="warning">
          {t('versionHistory.cleanupWarning')}
        </Text>
      </Space>
    </Modal>
  );

  const tabItems = [
    { key: 'contacts', label: t('versionHistory.contacts') },
    { key: 'messages', label: t('versionHistory.messages') },
    { key: 'call_logs', label: t('versionHistory.callLogs') },
    { key: 'folders', label: t('versionHistory.folderSync') },
  ];

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
              <HistoryOutlined /> {t('versionHistory.title')}
            </Title>
            <Space wrap>
              <Button
                type={compareMode ? 'primary' : 'default'}
                icon={<SwapOutlined />}
                onClick={() => {
                  setCompareMode(!compareMode);
                  setSelectedForCompare([]);
                }}
              >
                {t('versionHistory.compare')}
              </Button>
              {compareMode && selectedForCompare.length === 2 && (
                <Button
                  type="primary"
                  icon={<SwapOutlined />}
                  loading={loadingCompare}
                  onClick={handleCompare}
                >
                  {t('versionHistory.compareVersions')}
                </Button>
              )}
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => setCleanupModalVisible(true)}
              >
                {t('versionHistory.deleteOld')}
              </Button>
            </Space>
          </div>

          {compareMode && (
            <Alert
              type="info"
              showIcon
              message={t('versionHistory.selectTwoVersions')}
              description={
                selectedForCompare.length > 0
                  ? `${selectedForCompare.length}/2 ${t('versionHistory.selected')}`
                  : undefined
              }
            />
          )}
        </Space>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key as DataType);
            setSelectedForCompare([]);
          }}
          items={tabItems.map((item) => ({
            key: item.key,
            label: item.label,
            children: (
              <Spin spinning={loading}>
                <div style={{ padding: '24px 0' }}>
                  {renderTimeline(versions[item.key as DataType])}
                </div>
              </Spin>
            ),
          }))}
        />
      </Card>

      {renderDetailModal()}
      {renderCompareModal()}
      {renderCleanupModal()}
    </div>
  );
};
