import React, { useEffect, useState } from 'react';
import {
  Layout,
  List,
  Input,
  Button,
  Space,
  Card,
  Typography,
  message,
  Empty,
  Spin,
  Avatar,
  Badge,
  Dropdown,
  Modal,
  Timeline,
  Tag,
} from 'antd';
import {
  SearchOutlined,
  ExportOutlined,
  SyncOutlined,
  UserOutlined,
  HistoryOutlined,
  EyeOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatRelativeTime } from '../utils/format';
import { VersionPreview } from '../components/VersionPreview';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;
const { Search } = Input;

interface Conversation {
  threadId: string;
  address: string;
  contactName?: string;
  lastMessage: string;
  lastMessageDate: string;
  unreadCount?: number;
  messageCount: number;
}

interface Message {
  id: string;
  threadId: string;
  address: string;
  body: string;
  date: string;
  type: number; // 1=received, 2=sent
  read: boolean;
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

export const Messages: React.FC = () => {
  const { t } = useTranslation();
  const { connectedDevice } = useStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [exporting, setExporting] = useState(false);
  // 版本历史 / Version history
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [versionHistory, setVersionHistory] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null);

  useEffect(() => {
    if (connectedDevice) {
      loadConversations();
    }
  }, [connectedDevice]);

  useEffect(() => {
    filterConversations();
  }, [searchText, conversations]);

  const loadConversations = async () => {
    if (!connectedDevice) return;
    setLoading(true);
    try {
      const data = await tauriInvoke<Conversation[]>('get_conversations', {
        serial: connectedDevice.serial,
      });
      setConversations(data || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      message.error(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filterConversations = () => {
    if (!searchText.trim()) {
      setFilteredConversations(conversations);
      return;
    }
    const text = searchText.toLowerCase();
    const filtered = conversations.filter(
      (conv) =>
        conv.address?.toLowerCase().includes(text) ||
        conv.contactName?.toLowerCase().includes(text) ||
        conv.lastMessage?.toLowerCase().includes(text)
    );
    setFilteredConversations(filtered);
  };

  const loadMessages = async (threadId: string) => {
    if (!connectedDevice) return;
    setLoadingMessages(true);
    setSelectedThreadId(threadId);
    try {
      const data = await tauriInvoke<Message[]>('get_messages', {
        serial: connectedDevice.serial,
        threadId,
      });
      setMessages(data || []);
    } catch (error) {
      console.error('Failed to load messages:', error);
      message.error(t('messages.loadMessagesFailed'));
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSync = async () => {
    if (!connectedDevice) return;
    setSyncing(true);
    try {
      await tauriInvoke('trigger_sync', {
        serial: connectedDevice.serial,
        dataType: 'messages',
      });
      message.success(t('messages.syncStarted'));
      setTimeout(loadConversations, 2000);
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
      const path = await tauriInvoke<string>('export_messages', {
        serial: connectedDevice.serial,
        format,
        outputPath: `messages_export_${Date.now()}.${format}`,
      });
      message.success(t('messages.exportSuccess', { path }));
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
        dataType: 'messages',
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
          loadConversations();
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

  const exportMenuItems = [
    { key: 'json', label: t('common.jsonFormat') },
    { key: 'csv', label: t('common.csvFormat') },
    { key: 'txt', label: t('common.txtFormat') },
  ];

  const selectedConversation = conversations.find(
    (conv) => conv.threadId === selectedThreadId
  );

  if (!connectedDevice) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 20px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size="large">
              <Title level={3}>{t('common.connectDeviceTitle')}</Title>
              <Text type="secondary">{t('messages.connectDeviceDesc')}</Text>
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
              {t('messages.title')}
            </Title>
            <Space wrap>
              <Search
                placeholder={t('messages.searchPlaceholder')}
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
            </Space>
          </div>
        </Space>

        <Layout style={{ background: '#fff', minHeight: 600 }}>
          <Sider width={350} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0' }}>
            <Spin spinning={loading}>
              <List
                dataSource={filteredConversations}
                renderItem={(conv) => (
                  <List.Item
                    key={conv.threadId}
                    onClick={() => loadMessages(conv.threadId)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor:
                        selectedThreadId === conv.threadId ? '#e6f7ff' : 'transparent',
                      padding: '12px 16px',
                    }}
                  >
                    <List.Item.Meta
                      avatar={
                        <Badge count={conv.unreadCount || 0} offset={[-5, 5]}>
                          <Avatar icon={<UserOutlined />} />
                        </Badge>
                      }
                      title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text strong>{conv.contactName || conv.address}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatRelativeTime(conv.lastMessageDate)}
                          </Text>
                        </div>
                      }
                      description={
                        <div>
                          <Text ellipsis type="secondary" style={{ fontSize: 13, display: 'block' }}>
                            {conv.lastMessage}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('messages.messageCount', { count: conv.messageCount })}
                          </Text>
                        </div>
                      }
                    />
                  </List.Item>
                )}
                locale={{
                  emptyText: (
                    <Empty
                      description={searchText ? t('messages.noMatch') : t('messages.noData')}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ),
                }}
              />
            </Spin>
          </Sider>

          <Content style={{ padding: '16px', background: '#fff' }}>
            {selectedThreadId ? (
              <Spin spinning={loadingMessages}>
                <div>
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', marginBottom: 16 }}>
                    <Title level={4} style={{ margin: 0 }}>
                      {selectedConversation?.contactName || selectedConversation?.address}
                    </Title>
                    {selectedConversation?.contactName && (
                      <Text type="secondary">{selectedConversation.address}</Text>
                    )}
                  </div>

                  <div style={{ height: 480, overflowY: 'auto', padding: '0 16px' }}>
                    {messages.length > 0 ? (
                      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        {messages.map((msg) => {
                          const isSent = msg.type === 2;
                          return (
                            <div key={msg.id} style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start' }}>
                              <div style={{
                                maxWidth: '70%', padding: '10px 14px', borderRadius: '12px',
                                backgroundColor: isSent ? '#1890ff' : '#f0f0f0',
                                color: isSent ? '#fff' : '#000',
                              }}>
                                <div style={{ wordBreak: 'break-word' }}>{msg.body}</div>
                                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.8, textAlign: 'right' }}>
                                  {formatDate(msg.date)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </Space>
                    ) : (
                      <Empty description={t('messages.noMessages')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </div>
                </div>
              </Spin>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description={t('messages.selectConversation')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            )}
          </Content>
        </Layout>
      </Card>

      {/* 版本历史弹窗 / Version history modal */}
      <Modal
        title={<><HistoryOutlined /> {t('versionHistory.title')} - {t('versionHistory.messages')}</>}
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
                  <VersionPreview dataType="messages" data={beforeData} />
                </>
              )}
              {afterData && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>{t('versionHistory.after')}</Title>
                  <VersionPreview dataType="messages" data={afterData} />
                </>
              )}
            </>
          );
        })()}
      </Modal>
    </div>
  );
};
