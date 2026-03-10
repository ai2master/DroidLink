import React from 'react';
import { Descriptions, Tag, Space, Typography } from 'antd';
import {
  PhoneOutlined,
  MailOutlined,
  UserOutlined,
  TeamOutlined,
  MessageOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDuration, callTypeColor } from '../utils/format';

const { Text } = Typography;

interface VersionPreviewProps {
  dataType: string;
  data: any;
  compact?: boolean;
}

/**
 * 版本数据富预览组件 - 根据数据类型渲染人类可读的卡片
 * Rich preview component for version data - renders human-readable cards by data type
 */
export const VersionPreview: React.FC<VersionPreviewProps> = ({ dataType, data, compact = false }) => {
  const { t } = useTranslation();

  if (!data) {
    return <Text type="secondary">{t('versionHistory.noData')}</Text>;
  }

  switch (dataType) {
    case 'contacts':
      return <ContactPreview data={data} compact={compact} />;
    case 'messages':
      return <MessagePreview data={data} compact={compact} />;
    case 'call_logs':
      return <CallLogPreview data={data} compact={compact} />;
    default:
      return (
        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
};

const ContactPreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const phones = parseJsonArray(data.phone_numbers);
  const emails = parseJsonArray(data.emails);

  if (compact) {
    return (
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space>
          <UserOutlined />
          <Text strong>{data.display_name || '-'}</Text>
        </Space>
        {phones.length > 0 && (
          <Space>
            <PhoneOutlined style={{ color: '#52c41a' }} />
            <Text>{phones.join(', ')}</Text>
          </Space>
        )}
        {emails.length > 0 && (
          <Space>
            <MailOutlined style={{ color: '#1677ff' }} />
            <Text>{emails.join(', ')}</Text>
          </Space>
        )}
      </Space>
    );
  }

  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label={<><UserOutlined /> {t('contacts.name')}</>}>
        {data.display_name || '-'}
      </Descriptions.Item>
      <Descriptions.Item label={<><PhoneOutlined /> {t('contacts.phone')}</>}>
        {phones.length > 0 ? phones.map((p: string, i: number) => (
          <Tag key={i} color="green">{p}</Tag>
        )) : '-'}
      </Descriptions.Item>
      <Descriptions.Item label={<><MailOutlined /> {t('contacts.email')}</>}>
        {emails.length > 0 ? emails.map((e: string, i: number) => (
          <Tag key={i} color="blue">{e}</Tag>
        )) : '-'}
      </Descriptions.Item>
      <Descriptions.Item label={<><TeamOutlined /> {t('contacts.organization')}</>}>
        {data.organization || '-'}
      </Descriptions.Item>
    </Descriptions>
  );
};

const MessagePreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const isSent = data.msg_type === 2;

  if (compact) {
    return (
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space>
          <MessageOutlined />
          <Text strong>{data.contact_name || data.address || '-'}</Text>
          <Tag color={isSent ? 'blue' : 'green'}>{isSent ? t('messages.sent') : t('messages.received')}</Tag>
        </Space>
        <Text ellipsis style={{ maxWidth: 400 }}>{data.body || '-'}</Text>
      </Space>
    );
  }

  return (
    <div>
      <Descriptions bordered size="small" column={1} style={{ marginBottom: 8 }}>
        <Descriptions.Item label={t('messages.contact')}>
          {data.contact_name || data.address || '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('messages.address')}>
          {data.address || '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('messages.type')}>
          <Tag color={isSent ? 'blue' : 'green'}>{isSent ? t('messages.sent') : t('messages.received')}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('messages.date')}>
          {data.date ? formatDate(data.date) : '-'}
        </Descriptions.Item>
      </Descriptions>
      <div style={{
        padding: '10px 14px',
        borderRadius: 12,
        backgroundColor: isSent ? '#1890ff' : '#f0f0f0',
        color: isSent ? '#fff' : '#000',
        maxWidth: '80%',
        marginLeft: isSent ? 'auto' : 0,
        marginTop: 8,
      }}>
        <div style={{ wordBreak: 'break-word' }}>{data.body || '-'}</div>
      </div>
    </div>
  );
};

const CallLogPreview: React.FC<{ data: any; compact: boolean }> = ({ data, compact }) => {
  const { t } = useTranslation();
  const callType = data.call_type ?? 0;
  const color = callTypeColor(callType);
  const typeLabel = callType === 1 ? t('callLogs.incoming')
    : callType === 2 ? t('callLogs.outgoing')
    : callType === 3 ? t('callLogs.missed')
    : t('callLogs.other');

  if (compact) {
    return (
      <Space>
        <PhoneOutlined style={{ color, transform: callType === 1 ? 'rotate(135deg)' : callType === 2 ? 'rotate(-45deg)' : 'none' }} />
        <Tag color={color}>{typeLabel}</Tag>
        <Text strong>{data.contact_name || data.number || '-'}</Text>
        {data.duration > 0 && (
          <Text type="secondary"><ClockCircleOutlined /> {formatDuration(data.duration)}</Text>
        )}
      </Space>
    );
  }

  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label={t('callLogs.type')}>
        <Space>
          <PhoneOutlined style={{ color, transform: callType === 1 ? 'rotate(135deg)' : callType === 2 ? 'rotate(-45deg)' : 'none' }} />
          <Tag color={color}>{typeLabel}</Tag>
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label={t('callLogs.number')}>
        {data.number || '-'}
      </Descriptions.Item>
      <Descriptions.Item label={t('callLogs.contact')}>
        {data.contact_name || '-'}
      </Descriptions.Item>
      <Descriptions.Item label={t('callLogs.date')}>
        {data.date ? formatDate(data.date) : '-'}
      </Descriptions.Item>
      <Descriptions.Item label={t('callLogs.duration')}>
        {data.duration > 0 ? formatDuration(data.duration) : '-'}
      </Descriptions.Item>
    </Descriptions>
  );
};

function parseJsonArray(val: any): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

export default VersionPreview;
