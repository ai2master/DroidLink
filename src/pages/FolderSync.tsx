import { useState, useEffect } from 'react';
import {
  Button, Card, Space, Table, Tag, Modal, Input, Select, message, Empty,
  Tooltip, Progress, Popconfirm, Alert, Descriptions, InputNumber, Collapse,
  Typography, Statistic, Row, Col, Divider,
} from 'antd';
import {
  SyncOutlined, PlusOutlined, DeleteOutlined, PlayCircleOutlined,
  SwapOutlined, ArrowRightOutlined, ArrowLeftOutlined, FolderOpenOutlined,
  SettingOutlined, WarningOutlined, ThunderboltOutlined, ClockCircleOutlined,
  FileTextOutlined, ClearOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke, tauriListen } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { formatDate, formatRelativeTime } from '../utils/format';
import { open } from '@tauri-apps/plugin-dialog';

const { Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

interface SyncPair {
  id: string;
  device_serial: string;
  local_path: string;
  remote_path: string;
  direction: string;
  enabled: boolean;
  last_synced: string | null;
  created_at: string;
}

interface SyncProgress {
  pairId: string;
  current?: number;
  total?: number;
  file?: string;
  action?: string;
  bytes?: number;
  type?: string;
  result?: SyncResultData;
  message?: string;
}

interface SyncResultData {
  pushed: number;
  pulled: number;
  deleted_local: number;
  deleted_remote: number;
  conflicts: number;
  skipped: number;
  errors: string[];
  bytes_pushed: number;
  bytes_pulled: number;
  duration_ms: number;
  speed_mbps: number;
}

interface TransferInfo {
  usb_speed: string;
  estimated_speed: string;
  max_file_size: string;
  filesystem: string;
  has_fat32_limit: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
}

export default function FolderSync() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [newPair, setNewPair] = useState({
    localPath: '', remotePath: '/sdcard/', direction: 'bidirectional', conflictPolicy: 'keep_both',
  });
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({});
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [lastResults, setLastResults] = useState<Record<string, SyncResultData>>({});

  const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // 忽略规则编辑器 / Ignore patterns editor
  const [ignoreVisible, setIgnoreVisible] = useState(false);
  const [ignoreContent, setIgnoreContent] = useState('');
  const [ignoreLocalPath, setIgnoreLocalPath] = useState('');

  // 版本清理 / Version cleanup
  const [cleanupVisible, setCleanupVisible] = useState(false);
  const [cleanupPath, setCleanupPath] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [cleaningUp, setCleaningUp] = useState(false);

  // 方向标签 / Direction labels
  const directionLabel: Record<string, { text: string; icon: React.ReactNode; color: string }> = {
    bidirectional: { text: t('folderSync.bidirectional'), icon: <SwapOutlined />, color: 'blue' },
    push: { text: t('folderSync.pushToPhone'), icon: <ArrowRightOutlined />, color: 'green' },
    pull: { text: t('folderSync.pullToPC'), icon: <ArrowLeftOutlined />, color: 'orange' },
  };

  // 冲突策略 / Conflict policies
  const conflictPolicies = [
    { value: 'keep_both', label: t('folderSync.keepBoth') },
    { value: 'local_wins', label: t('folderSync.localWins') },
    { value: 'remote_wins', label: t('folderSync.remoteWins') },
    { value: 'newest_wins', label: t('folderSync.newestWins') },
  ];

  const loadPairs = async () => {
    setLoading(true);
    try {
      const result = await tauriInvoke<SyncPair[]>('get_folder_sync_pairs');
      setPairs(result);
    } catch (err: any) {
      message.error(t('folderSync.loadFailed', { error: err }));
    } finally {
      setLoading(false);
    }
  };

  const loadTransferInfo = async () => {
    if (!device) return;
    setLoadingInfo(true);
    try {
      const info = await tauriInvoke<TransferInfo>('get_transfer_info', { serial: device.serial });
      setTransferInfo(info);
    } catch (err: any) {
      console.warn('Failed to load transfer info:', err);
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    loadPairs();
    loadTransferInfo();
    const unlisten = tauriListen<SyncProgress>('folder-sync-progress', (data) => {
      setProgress((prev) => ({ ...prev, [data.pairId]: data }));
      if (data.type === 'completed' || data.type === 'error') {
        setSyncing((prev) => {
          const next = new Set(prev);
          next.delete(data.pairId);
          return next;
        });
        if (data.type === 'completed' && data.result) {
          const r = data.result;
          setLastResults((prev) => ({ ...prev, [data.pairId]: r }));
          message.success(
            t('folderSync.syncComplete', {
              pushed: r.pushed,
              pulled: r.pulled,
              deleted: r.deleted_local + r.deleted_remote,
            }) + ` ${formatBytes(r.bytes_pushed + r.bytes_pulled)} @ ${r.speed_mbps.toFixed(1)} MB/s`
          );
        }
        if (data.type === 'error') {
          message.error(t('folderSync.syncFailed', { error: data.message }));
        }
        loadPairs();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (device) loadTransferInfo();
  }, [device?.serial]);

  const handleAdd = async () => {
    if (!newPair.localPath || !newPair.remotePath || !device) {
      message.warning(t('folderSync.fillComplete'));
      return;
    }
    try {
      await tauriInvoke('add_folder_sync_pair', {
        pair: {
          deviceSerial: device.serial,
          localPath: newPair.localPath,
          remotePath: newPair.remotePath,
          direction: newPair.direction,
          conflictPolicy: newPair.conflictPolicy,
        },
      });
      message.success(t('folderSync.pairAdded'));
      setAddVisible(false);
      setNewPair({ localPath: '', remotePath: '/sdcard/', direction: 'bidirectional', conflictPolicy: 'keep_both' });
      loadPairs();
    } catch (err: any) {
      message.error(t('folderSync.addFailed', { error: err }));
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await tauriInvoke('remove_folder_sync_pair', { pairId: id });
      message.success(t('folderSync.deleted'));
      loadPairs();
    } catch (err: any) {
      message.error(t('folderSync.removeFailed', { error: err }));
    }
  };

  const handleSync = async (id: string) => {
    setSyncing((prev) => new Set(prev).add(id));
    try {
      await tauriInvoke('trigger_folder_sync', { pairId: id });
    } catch (err: any) {
      message.error(t('folderSync.syncFailed', { error: err }));
      setSyncing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const selectLocalPath = async () => {
    const path = await open({ directory: true, title: t('folderSync.selectLocalFolder') });
    if (path) setNewPair((p) => ({ ...p, localPath: path as string }));
  };

  const openIgnoreEditor = async (localPath: string) => {
    setIgnoreLocalPath(localPath);
    try {
      const ignorePath = localPath.replace(/\/$/, '') + '/.droidlinkignore';
      try {
        const content = await tauriInvoke<string>('read_text_file', { path: ignorePath });
        setIgnoreContent(content);
      } catch {
        setIgnoreContent(
          '# DroidLink ignore rules (similar to Syncthing .stignore)\n' +
          '# One rule per line, supports glob wildcards\n' +
          '# Lines starting with ! un-ignore (force include)\n' +
          '# Lines starting with # are comments\n' +
          '#\n' +
          '# Examples:\n' +
          '# *.tmp\n' +
          '# node_modules/\n' +
          '# .git/\n' +
          '# !important.tmp\n'
        );
      }
    } catch {
      setIgnoreContent('');
    }
    setIgnoreVisible(true);
  };

  const saveIgnoreFile = async () => {
    try {
      const ignorePath = ignoreLocalPath.replace(/\/$/, '') + '/.droidlinkignore';
      await tauriInvoke('write_text_file', { path: ignorePath, content: ignoreContent });
      message.success(t('folderSync.ignoreRulesSaved'));
      setIgnoreVisible(false);
    } catch (err: any) {
      message.error(t('folderSync.saveFailed', { error: err }));
    }
  };

  const handleCleanVersions = async () => {
    setCleaningUp(true);
    try {
      const count = await tauriInvoke<number>('clean_folder_versions', {
        localPath: cleanupPath,
        retentionDays,
      });
      message.success(t('folderSync.cleaned', { count }));
      setCleanupVisible(false);
    } catch (err: any) {
      message.error(t('folderSync.cleanFailed', { error: err }));
    } finally {
      setCleaningUp(false);
    }
  };

  if (!device) {
    return (
      <>
        <div className="page-header"><h2>{t('folderSync.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Empty description={t('common.connectDevice')} />
        </div>
      </>
    );
  }

  const columns = [
    {
      title: t('folderSync.localPath'),
      dataIndex: 'local_path',
      key: 'local_path',
      ellipsis: true,
      render: (path: string) => (
        <Tooltip title={path}>
          <Space>
            <FolderOpenOutlined />
            <span>{path}</span>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: t('folderSync.direction'),
      dataIndex: 'direction',
      key: 'direction',
      width: 140,
      render: (dir: string) => {
        const d = directionLabel[dir] || directionLabel.bidirectional;
        return <Tag icon={d.icon} color={d.color}>{d.text}</Tag>;
      },
    },
    {
      title: t('folderSync.remotePath'),
      dataIndex: 'remote_path',
      key: 'remote_path',
      ellipsis: true,
    },
    {
      title: t('folderSync.lastSynced'),
      dataIndex: 'last_synced',
      key: 'last_synced',
      width: 160,
      render: (date: string | null) => date ? (
        <Tooltip title={formatDate(date)}>{formatRelativeTime(date)}</Tooltip>
      ) : <span style={{ color: '#bfbfbf' }}>{t('common.never')}</span>,
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 260,
      render: (_: any, record: SyncPair) => {
        const prog = progress[record.id];
        if (syncing.has(record.id) && prog?.current != null && prog?.total != null) {
          return (
            <div>
              <Progress percent={Math.round((prog.current / prog.total) * 100)} size="small" />
              {prog.file && (
                <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                  {prog.action && <Tag color="blue" style={{ fontSize: 10, marginRight: 4 }}>{prog.action}</Tag>}
                  {prog.file}
                  {prog.bytes != null && prog.bytes > 0 && ` (${formatBytes(prog.bytes)})`}
                </Text>
              )}
            </div>
          );
        }
        if (syncing.has(record.id)) {
          return <Tag icon={<SyncOutlined spin />} color="processing">{t('folderSync.syncing')}</Tag>;
        }
        const last = lastResults[record.id];
        if (last) {
          return (
            <Tooltip title={`${formatBytes(last.bytes_pushed + last.bytes_pulled)} @ ${last.speed_mbps.toFixed(1)} MB/s, ${formatDurationMs(last.duration_ms)}`}>
              <Tag color="success">
                {t('folderSync.itemsSynced', { count: last.pushed + last.pulled + last.deleted_local + last.deleted_remote })}
              </Tag>
            </Tooltip>
          );
        }
        return <Tag color="default">{t('common.ready')}</Tag>;
      },
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 160,
      render: (_: any, record: SyncPair) => (
        <Space size="small">
          <Tooltip title={t('folderSync.syncNow')}>
            <Button type="text" size="small" icon={<PlayCircleOutlined />} loading={syncing.has(record.id)} onClick={() => handleSync(record.id)} />
          </Tooltip>
          <Tooltip title={t('folderSync.ignoreRules')}>
            <Button type="text" size="small" icon={<FileTextOutlined />} onClick={() => openIgnoreEditor(record.local_path)} />
          </Tooltip>
          <Tooltip title={t('folderSync.cleanVersions')}>
            <Button type="text" size="small" icon={<ClearOutlined />} onClick={() => { setCleanupPath(record.local_path); setCleanupVisible(true); }} />
          </Tooltip>
          <Popconfirm title={t('folderSync.deleteConfirm')} onConfirm={() => handleRemove(record.id)} okText={t('common.delete')} cancelText={t('common.cancel')}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <h2>{t('folderSync.title')}</h2>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>{t('folderSync.addPair')}</Button>
        </Space>
      </div>
      <div className="page-body">
        {/* 传输信息卡片 / Transfer Info Card */}
        {transferInfo && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={24}>
              <Col span={5}>
                <Statistic
                  title={t('folderSync.transferInfo.usbSpeed')}
                  value={transferInfo.usb_speed}
                  prefix={<ThunderboltOutlined />}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={5}>
                <Statistic
                  title={t('folderSync.transferInfo.estimatedSpeed')}
                  value={transferInfo.estimated_speed}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={5}>
                <Statistic
                  title={t('folderSync.transferInfo.filesystem')}
                  value={transferInfo.filesystem}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={5}>
                <Statistic
                  title={t('folderSync.transferInfo.maxFileSize')}
                  value={transferInfo.max_file_size}
                  valueStyle={{ fontSize: 16, color: transferInfo.has_fat32_limit ? '#ff4d4f' : undefined }}
                />
              </Col>
              <Col span={4} style={{ display: 'flex', alignItems: 'center' }}>
                {transferInfo.has_fat32_limit && (
                  <Alert
                    type="warning"
                    showIcon
                    icon={<WarningOutlined />}
                    message={t('folderSync.transferInfo.fat32Warning')}
                    description={t('folderSync.transferInfo.fat32Desc')}
                    style={{ padding: '4px 8px', fontSize: 11 }}
                  />
                )}
              </Col>
            </Row>
          </Card>
        )}

        {/* 同步对表格 / Sync Pairs Table */}
        <Table
          dataSource={pairs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: <Empty description={t('folderSync.noPairsHint')} /> }}
          expandable={{
            expandedRowRender: (record) => {
              const last = lastResults[record.id];
              if (!last) return <Text type="secondary">{t('folderSync.noStats')}</Text>;
              return (
                <Row gutter={16}>
                  <Col span={3}><Statistic title={t('folderSync.pushed')} value={last.pushed} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.pulled')} value={last.pulled} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.localDeleted')} value={last.deleted_local} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.remoteDeleted')} value={last.deleted_remote} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.conflicts')} value={last.conflicts} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.pushVolume')} value={formatBytes(last.bytes_pushed)} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.pullVolume')} value={formatBytes(last.bytes_pulled)} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={3}><Statistic title={t('folderSync.speed')} value={`${last.speed_mbps.toFixed(1)} MB/s`} valueStyle={{ fontSize: 14 }} /></Col>
                  {last.errors.length > 0 && (
                    <Col span={24} style={{ marginTop: 8 }}>
                      <Alert type="error" message={t('folderSync.errorsCount', { count: last.errors.length })} description={last.errors.join('\n')} />
                    </Col>
                  )}
                </Row>
              );
            },
            rowExpandable: (record) => !!lastResults[record.id],
          }}
        />

        {/* Syncthing 同步说明 / Syncthing-like features info */}
        <Card size="small" style={{ marginTop: 16 }}>
          <Collapse ghost>
            <Panel header={<><InfoCircleOutlined style={{ marginRight: 8 }} />{t('folderSync.synthing.title')}</>} key="info">
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t('folderSync.synthing.transport')}>{t('folderSync.synthing.transportDesc')}</Descriptions.Item>
                <Descriptions.Item label={t('folderSync.synthing.ignore')}>{t('folderSync.synthing.ignoreDesc')}</Descriptions.Item>
                <Descriptions.Item label={t('folderSync.synthing.versioning')}>{t('folderSync.synthing.versioningDesc')}</Descriptions.Item>
                <Descriptions.Item label={t('folderSync.synthing.conflict')}>{t('folderSync.synthing.conflictDesc')}</Descriptions.Item>
                <Descriptions.Item label={t('folderSync.synthing.incremental')}>{t('folderSync.synthing.incrementalDesc')}</Descriptions.Item>
                <Descriptions.Item label={t('folderSync.synthing.largeFile')}>{t('folderSync.synthing.largeFileDesc')}</Descriptions.Item>
              </Descriptions>
            </Panel>
          </Collapse>
        </Card>
      </div>

      {/* 添加同步对弹窗 / Add Sync Pair Modal */}
      <Modal
        title={t('folderSync.addTitle')}
        open={addVisible}
        onOk={handleAdd}
        onCancel={() => setAddVisible(false)}
        okText={t('common.add')}
        cancelText={t('common.cancel')}
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('folderSync.localPath')}</div>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={newPair.localPath} onChange={(e) => setNewPair((p) => ({ ...p, localPath: e.target.value }))} placeholder="/path/to/local/folder" />
              <Button onClick={selectLocalPath}>{t('common.browse')}</Button>
            </Space.Compact>
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('folderSync.remotePath')}</div>
            <Input value={newPair.remotePath} onChange={(e) => setNewPair((p) => ({ ...p, remotePath: e.target.value }))} placeholder="/sdcard/folder" />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('folderSync.direction')}</div>
            <Select
              value={newPair.direction}
              onChange={(v) => setNewPair((p) => ({ ...p, direction: v }))}
              style={{ width: '100%' }}
              options={[
                { value: 'bidirectional', label: t('folderSync.bidirectional') },
                { value: 'push', label: t('folderSync.pushToPhone') },
                { value: 'pull', label: t('folderSync.pullToPC') },
              ]}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('folderSync.conflictPolicy')}</div>
            <Select
              value={newPair.conflictPolicy}
              onChange={(v) => setNewPair((p) => ({ ...p, conflictPolicy: v }))}
              style={{ width: '100%' }}
              options={conflictPolicies}
            />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              {t('folderSync.conflictHint')}
            </Text>
          </div>
        </Space>
      </Modal>

      {/* 忽略规则编辑弹窗 / Ignore Patterns Editor Modal */}
      <Modal
        title={<><FileTextOutlined style={{ marginRight: 8 }} />{t('folderSync.editIgnoreRules')}</>}
        open={ignoreVisible}
        onOk={saveIgnoreFile}
        onCancel={() => setIgnoreVisible(false)}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={600}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('folderSync.ignoreRuleSyntax')}
          description={
            <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 12 }}>
              <li>{t('folderSync.ignoreRule1')}</li>
              <li>{t('folderSync.ignoreRule2')}</li>
              <li>{t('folderSync.ignoreRule3')}</li>
              <li>{t('folderSync.ignoreRule4')}</li>
            </ul>
          }
        />
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          {t('common.path')}: {ignoreLocalPath}/.droidlinkignore
        </Text>
        <TextArea
          value={ignoreContent}
          onChange={(e) => setIgnoreContent(e.target.value)}
          rows={14}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          placeholder="*.tmp&#10;node_modules/&#10;.git/&#10;!important.txt"
        />
      </Modal>

      {/* 版本清理弹窗 / Version Cleanup Modal */}
      <Modal
        title={<><ClearOutlined style={{ marginRight: 8 }} />{t('folderSync.cleanVersionsTitle')}</>}
        open={cleanupVisible}
        onOk={handleCleanVersions}
        onCancel={() => setCleanupVisible(false)}
        okText={t('common.clean')}
        cancelText={t('common.cancel')}
        confirmLoading={cleaningUp}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('folderSync.cleanVersionsTitle')}
          description={t('folderSync.versionExplain')}
        />
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {t('folderSync.syncPairPath', { path: cleanupPath })}
        </Text>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('folderSync.retentionDays')}</div>
        <InputNumber
          min={1}
          max={365}
          value={retentionDays}
          onChange={(v) => setRetentionDays(v ?? 30)}
          style={{ width: '100%' }}
          addonAfter={t('common.days')}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          {t('folderSync.retentionHint', { days: retentionDays })}
        </Text>
      </Modal>
    </>
  );
}
