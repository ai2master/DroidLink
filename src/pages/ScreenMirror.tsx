import { useState, useEffect } from 'react';
import {
  Play, Pause, Send, Trash2, CornerDownLeft, Eraser, Pen,
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

  const [inputMode, setInputMode] = useState<InputMode>('droidlink_ime');
  const [textInput, setTextInput] = useState('');
  const [passthroughInput, setPassthroughInput] = useState('');
  const [imeEnabled, setImeEnabled] = useState(false);
  const [imeStatus, setImeStatus] = useState<string>('');
  const [deviceImes, setDeviceImes] = useState<string[]>([]);
  const [currentIme, setCurrentIme] = useState('');

  useEffect(() => {
    checkScrcpy();
    if (device) {
      checkRunning();
      loadDeviceImes();
    }
  }, [device]);

  const checkScrcpy = async () => {
    try {
      const version = await tauriInvoke<string>('check_scrcpy');
      setScrcpyVersion(version);
      setScrcpyAvailable(true);
      setScrcpyError('');
    } catch (err: any) {
      setScrcpyAvailable(false);
      setScrcpyError(String(err));
    }
  };

  const checkRunning = async () => {
    if (!device) return;
    try {
      const result = await tauriInvoke<boolean>('is_scrcpy_running', { serial: device.serial });
      setRunning(result);
    } catch {}
  };

  const loadDeviceImes = async () => {
    if (!device) return;
    try {
      const imes = await tauriInvoke<string[]>('list_device_imes', { serial: device.serial });
      setDeviceImes(imes);
      const current = await tauriInvoke<string>('get_current_ime', { serial: device.serial });
      setCurrentIme(current);
      setImeEnabled(current.includes('com.droidlink'));
    } catch {}
  };

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
          preferText: false,
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
      </div>
    </>
  );
}
