import React from 'react';
import { Row, Col, Typography, Tag, Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/format';

const { Text, Title } = Typography;

interface VersionDiffViewProps {
  dataType: string;
  versionA: any;
  versionB: any;
  timestampA: string;
  timestampB: string;
  actionA?: string;
  actionB?: string;
}

interface FieldDef {
  key: string;
  label: string;
  render?: (val: any) => React.ReactNode;
}

/**
 * 版本对比组件 - 并排显示两个版本的差异，高亮变更字段
 * Version diff component - side-by-side comparison with highlighted changes
 */
export const VersionDiffView: React.FC<VersionDiffViewProps> = ({
  dataType, versionA, versionB, timestampA, timestampB, actionA, actionB,
}) => {
  const { t } = useTranslation();

  const fields = getFieldDefs(dataType, t);

  if (!versionA && !versionB) {
    return <Empty description={t('versionHistory.noChanges')} />;
  }

  const diffs = fields.map((field) => {
    const valA = getNestedValue(versionA, field.key);
    const valB = getNestedValue(versionB, field.key);
    const strA = normalizeValue(valA);
    const strB = normalizeValue(valB);
    const changed = strA !== strB;
    const added = !strA && strB;
    const removed = strA && !strB;
    return { ...field, valA, valB, strA, strB, changed, added, removed };
  });

  const hasChanges = diffs.some(d => d.changed);

  return (
    <div>
      {/* 版本标题 / Version headers */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small" style={{ background: '#fff7e6', borderColor: '#ffd591' }}>
            <Text strong>{t('versionHistory.versionA')}</Text>
            {actionA && <Tag style={{ marginLeft: 8 }}>{actionA}</Tag>}
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(timestampA)}</Text>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Text strong>{t('versionHistory.versionB')}</Text>
            {actionB && <Tag style={{ marginLeft: 8 }}>{actionB}</Tag>}
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(timestampB)}</Text>
          </Card>
        </Col>
      </Row>

      {!hasChanges && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Text type="secondary">{t('versionHistory.noChanges')}</Text>
        </div>
      )}

      {/* 逐字段对比 / Field-by-field comparison */}
      {diffs.map((diff) => {
        if (!diff.changed) return null;

        const renderVal = diff.render || ((v: any) => <Text>{normalizeValue(v) || '-'}</Text>);

        let statusTag: React.ReactNode;
        if (diff.added) {
          statusTag = <Tag color="success">{t('versionHistory.fieldAdded')}</Tag>;
        } else if (diff.removed) {
          statusTag = <Tag color="error">{t('versionHistory.fieldRemoved')}</Tag>;
        } else {
          statusTag = <Tag color="warning">{t('versionHistory.fieldChanged')}</Tag>;
        }

        return (
          <div key={diff.key} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong>{diff.label}</Text> {statusTag}
            </div>
            <Row gutter={16}>
              <Col span={12}>
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: diff.removed ? '#fff2f0' : diff.changed ? '#fff7e6' : '#fafafa',
                  border: `1px solid ${diff.removed ? '#ffccc7' : diff.changed ? '#ffe58f' : '#f0f0f0'}`,
                  minHeight: 36,
                  wordBreak: 'break-word',
                }}>
                  {diff.valA != null ? renderVal(diff.valA) : <Text type="secondary">-</Text>}
                </div>
              </Col>
              <Col span={12}>
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: diff.added ? '#f6ffed' : diff.changed ? '#f6ffed' : '#fafafa',
                  border: `1px solid ${diff.added ? '#b7eb8f' : diff.changed ? '#b7eb8f' : '#f0f0f0'}`,
                  minHeight: 36,
                  wordBreak: 'break-word',
                }}>
                  {diff.valB != null ? renderVal(diff.valB) : <Text type="secondary">-</Text>}
                </div>
              </Col>
            </Row>
          </div>
        );
      })}
    </div>
  );
};

function getFieldDefs(dataType: string, t: (key: string) => string): FieldDef[] {
  switch (dataType) {
    case 'contacts':
      return [
        { key: 'display_name', label: t('contacts.name') },
        { key: 'phone_numbers', label: t('contacts.phone'), render: renderJsonArray },
        { key: 'emails', label: t('contacts.email'), render: renderJsonArray },
        { key: 'organization', label: t('contacts.organization') },
      ];
    case 'messages':
      return [
        { key: 'address', label: t('messages.address') },
        { key: 'contact_name', label: t('messages.contact') },
        { key: 'body', label: t('messages.body') },
        { key: 'date', label: t('messages.date'), render: (v: any) => <Text>{v ? formatDate(v) : '-'}</Text> },
        { key: 'msg_type', label: t('messages.type'), render: (v: any) => <Tag color={v === 2 ? 'blue' : 'green'}>{v === 2 ? t('messages.sent') : t('messages.received')}</Tag> },
      ];
    case 'call_logs':
      return [
        { key: 'number', label: t('callLogs.number') },
        { key: 'contact_name', label: t('callLogs.contact') },
        { key: 'call_type', label: t('callLogs.type'), render: renderCallType(t) },
        { key: 'date', label: t('callLogs.date'), render: (v: any) => <Text>{v ? formatDate(v) : '-'}</Text> },
        { key: 'duration', label: t('callLogs.duration'), render: (v: any) => <Text>{v > 0 ? `${v}s` : '-'}</Text> },
      ];
    default:
      return [{ key: '_raw', label: 'Data' }];
  }
}

function renderJsonArray(val: any): React.ReactNode {
  let arr: string[] = [];
  if (Array.isArray(val)) arr = val;
  else if (typeof val === 'string') {
    try { arr = JSON.parse(val); } catch { arr = [val]; }
  }
  if (arr.length === 0) return <Text type="secondary">-</Text>;
  return (
    <>
      {arr.map((item, i) => <Tag key={i}>{item}</Tag>)}
    </>
  );
}

function renderCallType(t: (key: string) => string) {
  return (val: any) => {
    const type = Number(val);
    const label = type === 1 ? t('callLogs.incoming')
      : type === 2 ? t('callLogs.outgoing')
      : type === 3 ? t('callLogs.missed')
      : t('callLogs.other');
    return <Tag>{label}</Tag>;
  };
}

function getNestedValue(obj: any, key: string): any {
  if (!obj) return undefined;
  if (key === '_raw') return obj;
  return obj[key];
}

function normalizeValue(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export default VersionDiffView;
