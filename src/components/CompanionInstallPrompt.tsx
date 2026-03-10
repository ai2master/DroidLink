import React, { useState } from 'react';
import { Modal, Button, Space, Typography, Steps, Alert, Spin, Result } from 'antd';
import {
  AndroidOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  WarningOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';

const { Text, Title, Paragraph } = Typography;

interface CompanionInstallPromptProps {
  visible: boolean;
  serial: string;
  deviceName: string;
  onClose: () => void;
  onInstalled: () => void;
}

/**
 * Companion App 安装提示弹窗
 * 设备连接后，如果未安装 companion app，显示此弹窗提示用户安装
 * 必须用户主动点击"安装"按钮才会安装，不会自动安装
 *
 * Companion App install prompt modal
 * Shows when device connects without companion app installed
 * Installation ONLY happens when user explicitly clicks "Install" button
 */
export const CompanionInstallPrompt: React.FC<CompanionInstallPromptProps> = ({
  visible,
  serial,
  deviceName,
  onClose,
  onInstalled,
}) => {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleInstall = async () => {
    setInstalling(true);
    setInstallResult(null);
    setErrorMessage('');
    try {
      await tauriInvoke('install_companion_app', { serial });
      setInstallResult('success');
      setTimeout(() => {
        onInstalled();
      }, 1500);
    } catch (error: any) {
      setInstallResult('error');
      setErrorMessage(typeof error === 'string' ? error : error.message || t('companion.installFailed'));
    } finally {
      setInstalling(false);
    }
  };

  const handleClose = () => {
    setInstallResult(null);
    setErrorMessage('');
    setInstalling(false);
    onClose();
  };

  const renderContent = () => {
    if (installResult === 'success') {
      return (
        <Result
          status="success"
          title={t('companion.installSuccess')}
          subTitle={t('companion.installSuccessDesc')}
        />
      );
    }

    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          icon={<MobileOutlined />}
          message={t('companion.detected', { device: deviceName })}
          description={t('companion.notInstalled')}
        />

        <div>
          <Title level={5}>{t('companion.whyNeeded')}</Title>
          <Paragraph>
            <ul style={{ paddingLeft: 20 }}>
              <li>{t('companion.reason1')}</li>
              <li>{t('companion.reason2')}</li>
              <li>{t('companion.reason3')}</li>
              <li>{t('companion.reason4')}</li>
            </ul>
          </Paragraph>
        </div>

        <div>
          <Title level={5}>{t('companion.howItWorks')}</Title>
          <Steps
            direction="vertical"
            size="small"
            current={installing ? 1 : 0}
            items={[
              {
                title: t('companion.step1Title'),
                description: t('companion.step1Desc'),
                icon: <AndroidOutlined />,
              },
              {
                title: t('companion.step2Title'),
                description: t('companion.step2Desc'),
                icon: installing ? <LoadingOutlined /> : undefined,
              },
              {
                title: t('companion.step3Title'),
                description: t('companion.step3Desc'),
                icon: <CheckCircleOutlined />,
              },
            ]}
          />
        </div>

        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={t('companion.permissionNote')}
          description={t('companion.permissionNoteDesc')}
        />

        {installResult === 'error' && (
          <Alert
            type="error"
            showIcon
            message={t('companion.installFailed')}
            description={errorMessage}
          />
        )}
      </Space>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <AndroidOutlined style={{ color: '#3ddc84' }} />
          {t('companion.title')}
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      width={600}
      maskClosable={!installing}
      closable={!installing}
      footer={
        installResult === 'success'
          ? [
              <Button key="ok" type="primary" onClick={handleClose}>
                {t('common.confirm')}
              </Button>,
            ]
          : [
              <Button key="skip" onClick={handleClose} disabled={installing}>
                {t('companion.skipForNow')}
              </Button>,
              <Button
                key="install"
                type="primary"
                icon={installing ? <LoadingOutlined /> : <AndroidOutlined />}
                loading={installing}
                onClick={handleInstall}
              >
                {t('companion.install')}
              </Button>,
            ]
      }
    >
      <Spin spinning={installing} tip={t('companion.installing')}>
        {renderContent()}
      </Spin>
    </Modal>
  );
};

export default CompanionInstallPrompt;
