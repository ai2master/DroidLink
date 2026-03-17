import { useState, useEffect, useCallback } from 'react';
import {
  Play, Pause, Send, Trash2, CornerDownLeft, Eraser, Pen,
  ChevronDown, ChevronRight, Settings, Camera,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { useToast } from '../components/ui/toast';
import { Badge } from '../components/ui/badge';
import { cn } from '../utils/cn';

type InputMode = 'droidlink_ime' | 'keyboard_passthrough';

export default function ScreenMirror() {
  const { t } = useTranslation();
  const toast = useToast();
  const device = useStore((s) => s.connectedDevice);
  const [running, setRunning] = useState(false);
  const [scrcpyVersion, setScrcpyVersion] = useState('');
  const [scrcpyAvailable, setScrcpyAvailable] = useState(false);
  const [scrcpyError, setScrcpyError] = useState('');
  const [options, setOptions] = useState({
    maxSize: 1920,
    bitRate: 8,
    maxFps: 0,
    borderless: false,
    alwaysOnTop: false,
    fullscreen: false,
    noAudio: false,
    showTouches: false,
    stayAwake: true,
    turnScreenOff: false,
    noControl: false,
    forwardAllClicks: true,
    noMouseHover: false,
    otgMode: false,
  });
  // 摄像头镜像选项 / Camera mirroring options
  const [cameraMode, setCameraMode] = useState(false);
  const [cameraOptions, setCameraOptions] = useState({
    facing: 'back' as 'front' | 'back' | 'external',
    size: '',
    fps: 0,
    ar: '',
  });

  // 高级选项 / Advanced options
  const [advancedOptions, setAdvancedOptions] = useState({
    recordFile: '',
    windowTitle: '',
    crop: '',
    displayId: '',
    rotation: '',
    preferText: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [inputMode, setInputMode] = useState<InputMode>('droidlink_ime');
  const [textInput, setTextInput] = useState('');
  const [passthroughInput, setPassthroughInput] = useState('');
  const [imeEnabled, setImeEnabled] = useState(false);
  const [imeStatus, setImeStatus] = useState<string>('');
  const [deviceImes, setDeviceImes] = useState<string[]>([]);
  const [currentIme, setCurrentIme] = useState('');

  const checkScrcpy = useCallback(async () => {
    try {
      const version = await tauriInvoke<string>('check_scrcpy');
      setScrcpyVersion(version);
      setScrcpyAvailable(true);
      setScrcpyError('');
    } catch (err: any) {
      setScrcpyAvailable(false);
      setScrcpyError(String(err));
    }
  }, []);

  const checkRunning = useCallback(async () => {
    if (!device) return;
    try {
      const result = await tauriInvoke<boolean>('is_scrcpy_running', { serial: device.serial });
      setRunning(result);
    } catch {}
  }, [device]);

  const loadDeviceImes = useCallback(async () => {
    if (!device) return;
    try {
      const imes = await tauriInvoke<string[]>('list_device_imes', { serial: device.serial });
      setDeviceImes(imes);
      const current = await tauriInvoke<string>('get_current_ime', { serial: device.serial });
      setCurrentIme(current);
      setImeEnabled(current.includes('com.droidlink'));
    } catch {}
  }, [device]);

  useEffect(() => {
    checkScrcpy();
    if (device) {
      checkRunning();
      loadDeviceImes();
    }
  }, [device, checkScrcpy, checkRunning, loadDeviceImes]);

  // 轮询检测 scrcpy 进程是否退出 (用户手动关闭窗口时自动更新按钮状态)
  // Poll to detect scrcpy process exit (auto-update button when user closes the window)
  useEffect(() => {
    if (!running || !device) return;
    const interval = setInterval(async () => {
      try {
        const stillRunning = await tauriInvoke<boolean>('is_scrcpy_running', { serial: device.serial });
        if (!stillRunning) {
          setRunning(false);
        }
      } catch {
        setRunning(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [running, device]);

  const startMirror = async () => {
    if (!device) return;
    try {
      await tauriInvoke('start_scrcpy', {
        serial: device.serial,
        options: {
          maxSize: options.maxSize,
          bitRate: options.bitRate * 1_000_000,
          maxFps: options.maxFps,
          borderless: options.borderless,
          alwaysOnTop: options.alwaysOnTop,
          fullscreen: options.fullscreen,
          noAudio: options.noAudio,
          showTouches: options.showTouches,
          stayAwake: options.stayAwake,
          turnScreenOff: options.turnScreenOff,
          noControl: options.noControl,
          forwardAllClicks: options.forwardAllClicks,
          noMouseHover: options.noMouseHover,
          otgMode: options.otgMode,
          preferText: advancedOptions.preferText,
          recordFile: advancedOptions.recordFile || null,
          windowTitle: advancedOptions.windowTitle || null,
          crop: advancedOptions.crop || null,
          displayId: advancedOptions.displayId ? Number(advancedOptions.displayId) : null,
          rotation: advancedOptions.rotation ? Number(advancedOptions.rotation) : null,
          // 摄像头镜像 / Camera mirroring
          videoSource: cameraMode ? 'camera' : null,
          cameraFacing: cameraMode ? cameraOptions.facing : null,
          cameraSize: cameraMode && cameraOptions.size ? cameraOptions.size : null,
          cameraFps: cameraMode && cameraOptions.fps > 0 ? cameraOptions.fps : null,
          cameraAr: cameraMode && cameraOptions.ar ? cameraOptions.ar : null,
        },
      });
      setRunning(true);
      toast.success(t('screenMirror.startMirror'));
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const stopMirror = async () => {
    if (!device) return;
    try {
      await tauriInvoke('stop_scrcpy', { serial: device.serial });
      setRunning(false);
      toast.success(t('screenMirror.stopMirror'));
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendText = async () => {
    if (!device || !textInput) return;
    try {
      await tauriInvoke('send_text_to_device', { serial: device.serial, text: textInput });
      toast.success(t('screenMirror.sendText'));
      setTextInput('');
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendBackspace = async (count: number = 1) => {
    if (!device) return;
    try {
      await tauriInvoke('send_backspace_to_device', { serial: device.serial, count });
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendEnter = async () => {
    if (!device) return;
    try {
      await tauriInvoke('send_enter_to_device', { serial: device.serial });
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const setupIME = async () => {
    if (!device) return;
    try {
      const imeId = await tauriInvoke<string>('setup_droidlink_ime', { serial: device.serial });
      setImeEnabled(true);
      setImeStatus(imeId);
      setCurrentIme(imeId);
      toast.success(t('screenMirror.enableDroidLinkIME'));
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const restoreIME = async () => {
    if (!device) return;
    try {
      await tauriInvoke('restore_default_ime', { serial: device.serial });
      setImeEnabled(false);
      setImeStatus('');
      loadDeviceImes();
      toast.success(t('screenMirror.restoreDefaultIME'));
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendPassthroughText = async () => {
    if (!device || !passthroughInput) return;
    try {
      await tauriInvoke('passthrough_text', { serial: device.serial, text: passthroughInput });
      toast.success(t('screenMirror.sendText'));
      setPassthroughInput('');
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendPassthroughKey = async (keyCode: number) => {
    if (!device) return;
    try {
      await tauriInvoke('passthrough_keyevent', { serial: device.serial, keyCode });
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  const switchDeviceIme = async (imeId: string) => {
    if (!device) return;
    try {
      await tauriInvoke('switch_ime', { serial: device.serial, imeId });
      setCurrentIme(imeId);
      toast.success(t('screenMirror.switchIME'));
    } catch (err: any) {
      toast.error(`${t('common.error')}: ${err}`);
    }
  };

  if (!device) {
    return (
      <>
        <div className="page-header"><h2>{t('screenMirror.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <div className="text-center py-12 text-gray-400">{t('common.connectDevice')}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center gap-2">
          <h2>{t('screenMirror.title')}</h2>
          <Badge variant={running ? 'success' : 'default'}>{running ? t('common.running') : t('common.stopped')}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <Button variant="destructive" onClick={stopMirror}>
              <Pause size={16} />
              {t('screenMirror.stopMirror')}
            </Button>
          ) : (
            <Button variant="primary" onClick={startMirror} disabled={!scrcpyAvailable}>
              <Play size={16} />
              {t('screenMirror.startMirror')}
            </Button>
          )}
        </div>
      </div>
      <div className="page-body">
        {!scrcpyAvailable && (
          <div className="flex flex-col gap-2 p-3 rounded-[var(--border-radius)] bg-yellow-50 border border-yellow-200 text-[var(--font-size-sm)] mb-4">
            <span className="text-yellow-800">
              <strong>{t('screenMirror.scrcpyNotFound')}</strong><br />
              {scrcpyError.includes('Bundled scrcpy not found')
                ? t('screenMirror.bundledScrcpyNotFound')
                : t('screenMirror.scrcpyInstallHint')}
            </span>
            {scrcpyError && (
              <pre className="text-xs text-yellow-700 bg-yellow-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">{scrcpyError}</pre>
            )}
          </div>
        )}
        {scrcpyAvailable && (
          <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)] mb-4">
            <span className="text-emerald-800">{t('screenMirror.scrcpyVersion', { version: scrcpyVersion })}</span>
          </div>
        )}

        <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)] mb-[var(--card-gap)]">
          <div className="font-semibold text-[var(--font-size-base)] mb-3 flex items-center gap-2">
            <Pen size={16} />
            {t('screenMirror.inputMode')}
          </div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setInputMode('droidlink_ime')}
              className={cn(
                "px-4 py-2 rounded-[var(--border-radius)] border transition-colors",
                inputMode === 'droidlink_ime'
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : "bg-white text-gray-700 border-border hover:bg-gray-50"
              )}
            >
              {t('screenMirror.inputModeDroidLink')}
            </button>
            <button
              onClick={() => setInputMode('keyboard_passthrough')}
              className={cn(
                "px-4 py-2 rounded-[var(--border-radius)] border transition-colors",
                inputMode === 'keyboard_passthrough'
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : "bg-white text-gray-700 border-border hover:bg-gray-50"
              )}
            >
              {t('screenMirror.inputModePassthrough')}
            </button>
          </div>

          {inputMode === 'droidlink_ime' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)]">
                <span className="text-emerald-800">{t('screenMirror.inputModeDroidLinkDesc')}</span>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  {!imeEnabled ? (
                    <Button variant="primary" onClick={setupIME}>
                      <Pen size={16} />
                      {t('screenMirror.enableDroidLinkIME')}
                    </Button>
                  ) : (
                    <Button onClick={restoreIME}>
                      <Pen size={16} />
                      {t('screenMirror.restoreDefaultIME')}
                    </Button>
                  )}
                  {imeEnabled && <Badge variant="success">{t('screenMirror.imeEnabled')}</Badge>}
                </div>
                {imeStatus && (
                  <div className="text-xs text-gray-500">
                    {t('screenMirror.currentIME')}: {imeStatus}
                  </div>
                )}
              </div>

              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t('screenMirror.inputPlaceholder')}
                rows={3}
                disabled={!imeEnabled}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendText(); }}
              />
              <div className="text-xs text-gray-500">{t('screenMirror.ctrlEnterHint')}</div>

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={sendText} disabled={!imeEnabled || !textInput}>
                  <Send size={16} />
                  {t('screenMirror.sendText')}
                </Button>
                <Button onClick={() => sendBackspace(1)} disabled={!imeEnabled}>
                  <Trash2 size={16} />
                  {t('screenMirror.backspace')}
                </Button>
                <Button onClick={sendEnter} disabled={!imeEnabled}>
                  <CornerDownLeft size={16} />
                  {t('screenMirror.enter')}
                </Button>
                <Button onClick={() => setTextInput('')} disabled={!textInput}>
                  <Eraser size={16} />
                  {t('common.clear')}
                </Button>
              </div>
            </div>
          )}

          {inputMode === 'keyboard_passthrough' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)]">
                <span className="text-emerald-800">{t('screenMirror.inputModePassthroughDesc')}</span>
              </div>

              {deviceImes.length > 0 && (
                <div>
                  <div className="mb-2 font-medium text-[var(--font-size-sm)]">{t('screenMirror.switchIME')}</div>
                  <Select value={currentIme} onValueChange={switchDeviceIme}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {deviceImes.map((ime) => (
                        <SelectItem key={ime} value={ime}>
                          {ime.split('/').pop() || ime}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-gray-500 mt-1">
                    {t('screenMirror.currentIME')}: {currentIme}
                  </div>
                </div>
              )}

              <Textarea
                value={passthroughInput}
                onChange={(e) => setPassthroughInput(e.target.value)}
                placeholder={t('screenMirror.passthroughPlaceholder')}
                rows={3}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendPassthroughText(); }}
              />

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={sendPassthroughText} disabled={!passthroughInput}>
                  <Send size={16} />
                  {t('screenMirror.sendText')}
                </Button>
                <Button onClick={() => sendPassthroughKey(67)}>
                  <Trash2 size={16} />
                  {t('screenMirror.backspace')}
                </Button>
                <Button onClick={() => sendPassthroughKey(66)}>
                  <CornerDownLeft size={16} />
                  {t('screenMirror.enter')}
                </Button>
                <Button onClick={() => sendPassthroughKey(62)}>Space</Button>
                <Button onClick={() => setPassthroughInput('')} disabled={!passthroughInput}>
                  <Eraser size={16} />
                  {t('common.clear')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-[var(--card-gap)]">
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('screenMirror.videoSettings')}</div>
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.maxResolution')}</span>
                <Input
                  type="number"
                  value={options.maxSize}
                  onChange={(e) => setOptions((o) => ({ ...o, maxSize: Number(e.target.value) || 0 }))}
                  min={0}
                  max={3840}
                  step={120}
                  disabled={running}
                  className="w-32"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span>{t('screenMirror.bitRate')}</span>
                  <span>{options.bitRate} Mbps</span>
                </div>
                <Slider
                  value={options.bitRate}
                  onChange={(v) => setOptions((o) => ({ ...o, bitRate: v }))}
                  min={1}
                  max={32}
                  disabled={running}
                />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.maxFps')}</span>
                <Input
                  type="number"
                  value={options.maxFps}
                  onChange={(e) => setOptions((o) => ({ ...o, maxFps: Number(e.target.value) || 0 }))}
                  min={0}
                  max={120}
                  disabled={running}
                  className="w-32"
                />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.disableAudio')}</span>
                <Switch checked={options.noAudio} onCheckedChange={(v) => setOptions((o) => ({ ...o, noAudio: v }))} disabled={running} />
              </div>
            </div>
          </div>

          {/* 摄像头镜像 / Camera Mirroring */}
          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3 flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {t('screenMirror.cameraTitle')}
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="flex-1 mr-4">
                  <span className="text-[var(--font-size-sm)]">{t('screenMirror.cameraMode')}</span>
                  <div className="text-[var(--font-size-xs)] text-gray-500 mt-0.5">
                    {t('screenMirror.cameraModeDesc')}
                  </div>
                </div>
                <Switch checked={cameraMode} onCheckedChange={setCameraMode} disabled={running} />
              </div>
              {cameraMode && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--font-size-sm)]">{t('screenMirror.cameraFacing')}</span>
                    <Select value={cameraOptions.facing} onValueChange={(v: 'front' | 'back' | 'external') => setCameraOptions((o) => ({ ...o, facing: v }))}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="back">{t('screenMirror.cameraBack')}</SelectItem>
                        <SelectItem value="front">{t('screenMirror.cameraFront')}</SelectItem>
                        <SelectItem value="external">{t('screenMirror.cameraExternal')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--font-size-sm)]">{t('screenMirror.cameraResolution')}</span>
                    <Input
                      value={cameraOptions.size}
                      onChange={(e) => setCameraOptions((o) => ({ ...o, size: e.target.value }))}
                      placeholder="1920x1080"
                      className="w-[180px]"
                      disabled={running}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--font-size-sm)]">{t('screenMirror.cameraFps')}</span>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={cameraOptions.fps || ''}
                      onChange={(e) => setCameraOptions((o) => ({ ...o, fps: parseInt(e.target.value) || 0 }))}
                      placeholder="30"
                      className="w-[180px]"
                      disabled={running}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--font-size-sm)]">{t('screenMirror.cameraAspectRatio')}</span>
                    <Input
                      value={cameraOptions.ar}
                      onChange={(e) => setCameraOptions((o) => ({ ...o, ar: e.target.value }))}
                      placeholder="16:9"
                      className="w-[180px]"
                      disabled={running}
                    />
                  </div>
                  <div className="text-[var(--font-size-xs)] text-gray-500 bg-gray-50 p-3 rounded-[var(--border-radius)]">
                    {t('screenMirror.cameraRequirement')}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('screenMirror.windowSettings')}</div>
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.borderless')}</span>
                <Switch checked={options.borderless} onCheckedChange={(v) => setOptions((o) => ({ ...o, borderless: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.alwaysOnTop')}</span>
                <Switch checked={options.alwaysOnTop} onCheckedChange={(v) => setOptions((o) => ({ ...o, alwaysOnTop: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.fullscreen')}</span>
                <Switch checked={options.fullscreen} onCheckedChange={(v) => setOptions((o) => ({ ...o, fullscreen: v }))} disabled={running} />
              </div>
            </div>
          </div>

          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('screenMirror.touchSettings')}</div>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 p-2 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-xs">
                <span className="text-emerald-800">{t('screenMirror.touchInfoDesc')}</span>
              </div>
              <div className="flex justify-between items-start">
                <div>
                  <div>{t('screenMirror.forwardAllClicks')}</div>
                  <div className="text-xs text-gray-500">{t('screenMirror.forwardAllClicksDesc')}</div>
                </div>
                <Switch checked={options.forwardAllClicks} onCheckedChange={(v) => setOptions((o) => ({ ...o, forwardAllClicks: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-start">
                <div>
                  <div>{t('screenMirror.noMouseHover')}</div>
                  <div className="text-xs text-gray-500">{t('screenMirror.noMouseHoverDesc')}</div>
                </div>
                <Switch checked={options.noMouseHover} onCheckedChange={(v) => setOptions((o) => ({ ...o, noMouseHover: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-start">
                <div>
                  <div>{t('screenMirror.otgMode')}</div>
                  <div className="text-xs text-gray-500">{t('screenMirror.otgModeDesc')}</div>
                </div>
                <Switch checked={options.otgMode} onCheckedChange={(v) => setOptions((o) => ({ ...o, otgMode: v }))} disabled={running} />
              </div>
            </div>
          </div>

          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('screenMirror.deviceControl')}</div>
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.showTouches')}</span>
                <Switch checked={options.showTouches} onCheckedChange={(v) => setOptions((o) => ({ ...o, showTouches: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.stayAwake')}</span>
                <Switch checked={options.stayAwake} onCheckedChange={(v) => setOptions((o) => ({ ...o, stayAwake: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.turnScreenOff')}</span>
                <Switch checked={options.turnScreenOff} onCheckedChange={(v) => setOptions((o) => ({ ...o, turnScreenOff: v }))} disabled={running} />
              </div>
              <div className="flex justify-between items-center">
                <span>{t('screenMirror.viewOnly')}</span>
                <Switch checked={options.noControl} onCheckedChange={(v) => setOptions((o) => ({ ...o, noControl: v }))} disabled={running} />
              </div>
            </div>
          </div>

          <div className="rounded-[var(--border-radius)] border border-border bg-white p-[var(--card-padding)]">
            <div className="font-semibold text-[var(--font-size-base)] mb-3">{t('screenMirror.deviceInfo')}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[var(--font-size-sm)]">
              <dt className="text-gray-500">{t('dashboard.device')}</dt>
              <dd>{device.displayName}</dd>
              <dt className="text-gray-500">{t('dashboard.model')}</dt>
              <dd>{device.model}</dd>
              <dt className="text-gray-500">{t('dashboard.android')}</dt>
              <dd>{device.androidVersion}</dd>
              <dt className="text-gray-500">{t('dashboard.serial')}</dt>
              <dd>{device.serial}</dd>
              <dt className="text-gray-500">{t('dashboard.battery')}</dt>
              <dd>{device.batteryLevel}%</dd>
            </dl>
          </div>
        </div>

        {/* 高级设置面板 / Advanced settings panel */}
        <div className="rounded-[var(--border-radius)] border border-border bg-white mt-[var(--card-gap)]">
          <button
            className="w-full flex items-center justify-between p-[var(--card-padding)] hover:bg-gray-50 transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <div className="flex items-center gap-2 font-semibold text-[var(--font-size-base)]">
              <Settings size={16} />
              {t('screenMirror.advancedSettings')}
            </div>
            {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {showAdvanced && (
            <div className="border-t border-border p-[var(--card-padding)]">
              <div className="flex gap-2 p-3 rounded-[var(--border-radius)] bg-emerald-50 border border-emerald-200 text-[var(--font-size-sm)] mb-4">
                <span className="text-emerald-800">{t('screenMirror.advancedSettingsDesc')}</span>
              </div>
              <div className="flex flex-col gap-5">
                {/* --record / 录制 */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advRecord')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--record</code>
                    </div>
                    <Input
                      value={advancedOptions.recordFile}
                      onChange={(e) => setAdvancedOptions((o) => ({ ...o, recordFile: e.target.value }))}
                      placeholder={t('screenMirror.advRecordPlaceholder')}
                      disabled={running}
                      className="w-64"
                    />
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advRecordDesc')}</span>
                </div>

                {/* --window-title / 窗口标题 */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advWindowTitle')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--window-title</code>
                    </div>
                    <Input
                      value={advancedOptions.windowTitle}
                      onChange={(e) => setAdvancedOptions((o) => ({ ...o, windowTitle: e.target.value }))}
                      placeholder={t('screenMirror.advWindowTitlePlaceholder')}
                      disabled={running}
                      className="w-64"
                    />
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advWindowTitleDesc')}</span>
                </div>

                {/* --crop / 裁剪 */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advCrop')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--crop</code>
                    </div>
                    <Input
                      value={advancedOptions.crop}
                      onChange={(e) => setAdvancedOptions((o) => ({ ...o, crop: e.target.value }))}
                      placeholder="1080:1920:0:0"
                      disabled={running}
                      className="w-64"
                    />
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advCropDesc')}</span>
                </div>

                {/* --display-id / 显示器ID */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advDisplayId')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--display-id</code>
                    </div>
                    <Input
                      type="number"
                      value={advancedOptions.displayId}
                      onChange={(e) => setAdvancedOptions((o) => ({ ...o, displayId: e.target.value }))}
                      placeholder="0"
                      disabled={running}
                      className="w-32"
                      min={0}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advDisplayIdDesc')}</span>
                </div>

                {/* --rotation / 旋转 */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advRotation')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--rotation</code>
                    </div>
                    <Select
                      value={advancedOptions.rotation || 'none'}
                      onValueChange={(v) => setAdvancedOptions((o) => ({ ...o, rotation: v === 'none' ? '' : v }))}
                    >
                      <SelectTrigger className="w-48" disabled={running}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('screenMirror.advRotationNone')}</SelectItem>
                        <SelectItem value="0">0° ({t('screenMirror.advRotationNatural')})</SelectItem>
                        <SelectItem value="1">90° ({t('screenMirror.advRotationCCW')})</SelectItem>
                        <SelectItem value="2">180°</SelectItem>
                        <SelectItem value="3">270° ({t('screenMirror.advRotationCW')})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advRotationDesc')}</span>
                </div>

                {/* --prefer-text / 文本优先 */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{t('screenMirror.advPreferText')}</span>
                      <code className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">--prefer-text</code>
                    </div>
                    <Switch
                      checked={advancedOptions.preferText}
                      onCheckedChange={(v) => setAdvancedOptions((o) => ({ ...o, preferText: v }))}
                      disabled={running}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advPreferTextDesc')}</span>
                </div>

                {/* --mouse-bind / 鼠标绑定说明 */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t('screenMirror.advMouseBind')}</span>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">--mouse-bind=++++</code>
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advMouseBindDesc')}</span>
                </div>

                {/* --stay-awake 说明 */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t('screenMirror.advStayAwake')}</span>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">--stay-awake</code>
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advStayAwakeDesc')}</span>
                </div>

                {/* --no-audio 说明 */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t('screenMirror.advNoAudio')}</span>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">--no-audio</code>
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advNoAudioDesc')}</span>
                </div>

                {/* --otg 说明 */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t('screenMirror.advOtg')}</span>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">--otg</code>
                  </div>
                  <span className="text-xs text-gray-500">{t('screenMirror.advOtgDesc')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
