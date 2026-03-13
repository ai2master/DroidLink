import React, { useState } from 'react';
import {
  Smartphone,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
} from './ui/dialog';
import { Button } from './ui/button';

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
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">{t('companion.installSuccess')}</h3>
          <p className="text-sm text-gray-500 text-center">{t('companion.installSuccessDesc')}</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Info Alert */}
        <div className="flex gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
          <Smartphone className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium text-blue-900">
              {t('companion.detected', { device: deviceName })}
            </div>
            <div className="text-sm text-blue-700">
              {t('companion.notInstalled')}
            </div>
          </div>
        </div>

        {/* Why Needed Section */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 mb-3">{t('companion.whyNeeded')}</h4>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('companion.reason1')}</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('companion.reason2')}</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('companion.reason3')}</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('companion.reason4')}</span>
            </li>
          </ul>
        </div>

        {/* How It Works Section */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 mb-3">{t('companion.howItWorks')}</h4>
          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 flex-shrink-0">
                <Smartphone className="w-4 h-4 text-gray-600" />
              </div>
              <div className="flex-1 pt-1">
                <div className="text-sm font-medium text-gray-900">{t('companion.step1Title')}</div>
                <div className="text-sm text-gray-600 mt-1">{t('companion.step1Desc')}</div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 ${installing ? 'bg-blue-100' : 'bg-gray-100'}`}>
                {installing ? (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                ) : (
                  <span className="text-sm font-medium text-gray-600">2</span>
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="text-sm font-medium text-gray-900">{t('companion.step2Title')}</div>
                <div className="text-sm text-gray-600 mt-1">{t('companion.step2Desc')}</div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-gray-600" />
              </div>
              <div className="flex-1 pt-1">
                <div className="text-sm font-medium text-gray-900">{t('companion.step3Title')}</div>
                <div className="text-sm text-gray-600 mt-1">{t('companion.step3Desc')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Warning Alert */}
        <div className="flex gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium text-amber-900">
              {t('companion.permissionNote')}
            </div>
            <div className="text-sm text-amber-700">
              {t('companion.permissionNoteDesc')}
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {installResult === 'error' && (
          <div className="flex gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-red-900">
                {t('companion.installFailed')}
              </div>
              <div className="text-sm text-red-700">
                {errorMessage}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && !installing && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" style={{ color: '#3ddc84' }} />
            {t('companion.title')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          {installing && installResult !== 'success' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <p className="text-center text-sm text-gray-600">{t('companion.installing')}</p>
              {renderContent()}
            </div>
          ) : (
            renderContent()
          )}
        </DialogBody>

        <DialogFooter>
          {installResult === 'success' ? (
            <Button variant="primary" onClick={handleClose}>
              {t('common.confirm')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={installing}>
                {t('companion.skipForNow')}
              </Button>
              <Button
                variant="primary"
                loading={installing}
                onClick={handleInstall}
              >
                {!installing && <Smartphone className="w-4 h-4" />}
                {t('companion.install')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompanionInstallPrompt;
