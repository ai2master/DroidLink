import { useState, useEffect } from 'react';
import {
  Button, Card, Space, Switch, InputNumber, Descriptions, message, Empty,
  Tag, Alert, Slider, Input, Radio, Select, Divider,
} from 'antd';
import {
  PlayCircleOutlined, PauseOutlined, SendOutlined, DeleteOutlined,
  EnterOutlined, ClearOutlined, EditOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';

const { TextArea } = Input;

// 输入模式 / Input mode
type InputMode = 'droidlink_ime' | 'keyboard_passthrough';

export default function ScreenMirror() {
  const { t } = useTranslation();
  const device = useStore((s) => s.connectedDevice);
  const [running, setRunning] = useState(false);
  const [scrcpyVersion, setScrcpyVersion] = useState('');
  const [scrcpyAvailable, setScrcpyAvailable] = useState(false);
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
    // 触摸屏选项 / Touch screen options
    forwardAllClicks: true,
    noMouseHover: false,
    otgMode: false,
  });

  // 输入模式和状态 / Input mode and state
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
    } catch {
      setScrcpyAvailable(false);
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
          max_size: options.maxSize,
          bit_rate: options.bitRate * 1_000_000,
          max_fps: options.maxFps,
          borderless: options.borderless,
          always_on_top: options.alwaysOnTop,
          fullscreen: options.fullscreen,
          no_audio: options.noAudio,
          show_touches: options.showTouches,
          stay_awake: options.stayAwake,
          turn_screen_off: options.turnScreenOff,
          no_control: options.noControl,
          forward_all_clicks: options.forwardAllClicks,
          no_mouse_hover: options.noMouseHover,
          otg_mode: options.otgMode,
          prefer_text: false,
        },
      });
      setRunning(true);
      message.success(t('screenMirror.startMirror'));
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const stopMirror = async () => {
    if (!device) return;
    try {
      await tauriInvoke('stop_scrcpy', { serial: device.serial });
      setRunning(false);
      message.success(t('screenMirror.stopMirror'));
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  // ========== DroidLink IME 模式函数 ==========
  // ========== DroidLink IME mode functions ==========

  const sendText = async () => {
    if (!device || !textInput) return;
    try {
      await tauriInvoke('send_text_to_device', { serial: device.serial, text: textInput });
      message.success(t('screenMirror.sendText'));
      setTextInput('');
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendBackspace = async (count: number = 1) => {
    if (!device) return;
    try {
      await tauriInvoke('send_backspace_to_device', { serial: device.serial, count });
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendEnter = async () => {
    if (!device) return;
    try {
      await tauriInvoke('send_enter_to_device', { serial: device.serial });
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const setupIME = async () => {
    if (!device) return;
    try {
      const imeId = await tauriInvoke<string>('setup_droidlink_ime', { serial: device.serial });
      setImeEnabled(true);
      setImeStatus(imeId);
      setCurrentIme(imeId);
      message.success(t('screenMirror.enableDroidLinkIME'));
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const restoreIME = async () => {
    if (!device) return;
    try {
      await tauriInvoke('restore_default_ime', { serial: device.serial });
      setImeEnabled(false);
      setImeStatus('');
      loadDeviceImes();
      message.success(t('screenMirror.restoreDefaultIME'));
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  // ========== 键盘直通模式函数 ==========
  // ========== Keyboard passthrough mode functions ==========

  const sendPassthroughText = async () => {
    if (!device || !passthroughInput) return;
    try {
      await tauriInvoke('passthrough_text', { serial: device.serial, text: passthroughInput });
      message.success(t('screenMirror.sendText'));
      setPassthroughInput('');
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const sendPassthroughKey = async (keyCode: number) => {
    if (!device) return;
    try {
      await tauriInvoke('passthrough_keyevent', { serial: device.serial, keyCode });
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  const switchDeviceIme = async (imeId: string) => {
    if (!device) return;
    try {
      await tauriInvoke('switch_ime', { serial: device.serial, imeId });
      setCurrentIme(imeId);
      message.success(t('screenMirror.switchIME'));
    } catch (err: any) {
      message.error(`${t('common.error')}: ${err}`);
    }
  };

  if (!device) {
    return (
      <>
        <div className="page-header"><h2>{t('screenMirror.title')}</h2></div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Empty description={t('common.connectDevice')} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <Space>
          <h2>{t('screenMirror.title')}</h2>
          <Tag color={running ? 'success' : 'default'}>{running ? t('common.running') : t('common.stopped')}</Tag>
        </Space>
        <Space>
          {running ? (
            <Button danger icon={<PauseOutlined />} onClick={stopMirror}>{t('screenMirror.stopMirror')}</Button>
          ) : (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startMirror} disabled={!scrcpyAvailable}>
              {t('screenMirror.startMirror')}
            </Button>
          )}
        </Space>
      </div>
      <div className="page-body">
        {!scrcpyAvailable && (
          <Alert
            type="warning" showIcon
            message={t('screenMirror.scrcpyNotFound')}
            description={t('screenMirror.scrcpyInstallHint')}
            style={{ marginBottom: 16 }}
          />
        )}
        {scrcpyAvailable && (
          <Alert type="info" showIcon
            message={t('screenMirror.scrcpyVersion', { version: scrcpyVersion })}
            style={{ marginBottom: 16 }} />
        )}

        {/* ========== 输入模式选择 / Input mode selection ========== */}
        <Card
          title={<Space><EditOutlined /><span>{t('screenMirror.inputMode')}</span></Space>}
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Radio.Group
            value={inputMode}
            onChange={(e) => setInputMode(e.target.value)}
            style={{ marginBottom: 16 }}
          >
            <Radio.Button value="droidlink_ime">
              {t('screenMirror.inputModeDroidLink')}
            </Radio.Button>
            <Radio.Button value="keyboard_passthrough">
              {t('screenMirror.inputModePassthrough')}
            </Radio.Button>
          </Radio.Group>

          {/* DroidLink IME 模式 / DroidLink IME mode */}
          {inputMode === 'droidlink_ime' && (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Alert type="info" showIcon
                message={t('screenMirror.inputModeDroidLinkDesc')} />

              <div>
                <Space style={{ marginBottom: 8 }}>
                  {!imeEnabled ? (
                    <Button type="primary" icon={<EditOutlined />} onClick={setupIME}>
                      {t('screenMirror.enableDroidLinkIME')}
                    </Button>
                  ) : (
                    <Button icon={<EditOutlined />} onClick={restoreIME}>
                      {t('screenMirror.restoreDefaultIME')}
                    </Button>
                  )}
                  {imeEnabled && <Tag color="success">{t('screenMirror.imeEnabled')}</Tag>}
                </Space>
                {imeStatus && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    {t('screenMirror.currentIME')}: {imeStatus}
                  </div>
                )}
              </div>

              <TextArea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t('screenMirror.inputPlaceholder')}
                rows={3}
                disabled={!imeEnabled}
                onPressEnter={(e) => { if (e.ctrlKey || e.metaKey) sendText(); }}
              />
              <div style={{ fontSize: 12, color: '#999' }}>{t('screenMirror.ctrlEnterHint')}</div>

              <Space wrap>
                <Button type="primary" icon={<SendOutlined />} onClick={sendText} disabled={!imeEnabled || !textInput}>
                  {t('screenMirror.sendText')}
                </Button>
                <Button icon={<DeleteOutlined />} onClick={() => sendBackspace(1)} disabled={!imeEnabled}>
                  {t('screenMirror.backspace')}
                </Button>
                <Button icon={<EnterOutlined />} onClick={sendEnter} disabled={!imeEnabled}>
                  {t('screenMirror.enter')}
                </Button>
                <Button icon={<ClearOutlined />} onClick={() => setTextInput('')} disabled={!textInput}>
                  {t('common.clear')}
                </Button>
              </Space>
            </Space>
          )}

          {/* 键盘直通模式 / Keyboard passthrough mode */}
          {inputMode === 'keyboard_passthrough' && (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Alert type="info" showIcon
                message={t('screenMirror.inputModePassthroughDesc')} />

              {/* 手机输入法选择 / Phone IME selection */}
              {deviceImes.length > 0 && (
                <div>
                  <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('screenMirror.switchIME')}</div>
                  <Select
                    value={currentIme}
                    onChange={switchDeviceIme}
                    style={{ width: '100%' }}
                    options={deviceImes.map((ime) => ({
                      value: ime,
                      label: ime.split('/').pop() || ime,
                    }))}
                  />
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                    {t('screenMirror.currentIME')}: {currentIme}
                  </div>
                </div>
              )}

              <TextArea
                value={passthroughInput}
                onChange={(e) => setPassthroughInput(e.target.value)}
                placeholder={t('screenMirror.passthroughPlaceholder')}
                rows={3}
                onPressEnter={(e) => { if (e.ctrlKey || e.metaKey) sendPassthroughText(); }}
              />

              <Space wrap>
                <Button type="primary" icon={<SendOutlined />} onClick={sendPassthroughText} disabled={!passthroughInput}>
                  {t('screenMirror.sendText')}
                </Button>
                <Button icon={<DeleteOutlined />} onClick={() => sendPassthroughKey(67)}>
                  {t('screenMirror.backspace')}
                </Button>
                <Button icon={<EnterOutlined />} onClick={() => sendPassthroughKey(66)}>
                  {t('screenMirror.enter')}
                </Button>
                <Button onClick={() => sendPassthroughKey(62)}>Space</Button>
                <Button icon={<ClearOutlined />} onClick={() => setPassthroughInput('')} disabled={!passthroughInput}>
                  {t('common.clear')}
                </Button>
              </Space>
            </Space>
          )}
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 视频设置 / Video settings */}
          <Card title={t('screenMirror.videoSettings')} size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.maxResolution')}</span>
                <InputNumber value={options.maxSize} onChange={(v) => setOptions((o) => ({ ...o, maxSize: v || 0 }))}
                  min={0} max={3840} step={120} addonAfter="px" style={{ width: 150 }} disabled={running} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t('screenMirror.bitRate')}</span>
                  <span>{options.bitRate} Mbps</span>
                </div>
                <Slider value={options.bitRate} onChange={(v) => setOptions((o) => ({ ...o, bitRate: v }))}
                  min={1} max={32} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.maxFps')}</span>
                <InputNumber value={options.maxFps} onChange={(v) => setOptions((o) => ({ ...o, maxFps: v || 0 }))}
                  min={0} max={120} addonAfter="fps" style={{ width: 150 }} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.disableAudio')}</span>
                <Switch checked={options.noAudio} onChange={(v) => setOptions((o) => ({ ...o, noAudio: v }))} disabled={running} />
              </div>
            </Space>
          </Card>

          {/* 窗口设置 / Window settings */}
          <Card title={t('screenMirror.windowSettings')} size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.borderless')}</span>
                <Switch checked={options.borderless} onChange={(v) => setOptions((o) => ({ ...o, borderless: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.alwaysOnTop')}</span>
                <Switch checked={options.alwaysOnTop} onChange={(v) => setOptions((o) => ({ ...o, alwaysOnTop: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.fullscreen')}</span>
                <Switch checked={options.fullscreen} onChange={(v) => setOptions((o) => ({ ...o, fullscreen: v }))} disabled={running} />
              </div>
            </Space>
          </Card>

          {/* 触摸屏设置 / Touch screen settings */}
          <Card title={t('screenMirror.touchSettings')} size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Alert type="info" showIcon message={t('screenMirror.touchInfoDesc')} style={{ padding: '4px 8px', fontSize: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div>{t('screenMirror.forwardAllClicks')}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{t('screenMirror.forwardAllClicksDesc')}</div>
                </div>
                <Switch checked={options.forwardAllClicks} onChange={(v) => setOptions((o) => ({ ...o, forwardAllClicks: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div>{t('screenMirror.noMouseHover')}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{t('screenMirror.noMouseHoverDesc')}</div>
                </div>
                <Switch checked={options.noMouseHover} onChange={(v) => setOptions((o) => ({ ...o, noMouseHover: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div>{t('screenMirror.otgMode')}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{t('screenMirror.otgModeDesc')}</div>
                </div>
                <Switch checked={options.otgMode} onChange={(v) => setOptions((o) => ({ ...o, otgMode: v }))} disabled={running} />
              </div>
            </Space>
          </Card>

          {/* 设备控制 / Device control */}
          <Card title={t('screenMirror.deviceControl')} size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.showTouches')}</span>
                <Switch checked={options.showTouches} onChange={(v) => setOptions((o) => ({ ...o, showTouches: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.stayAwake')}</span>
                <Switch checked={options.stayAwake} onChange={(v) => setOptions((o) => ({ ...o, stayAwake: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.turnScreenOff')}</span>
                <Switch checked={options.turnScreenOff} onChange={(v) => setOptions((o) => ({ ...o, turnScreenOff: v }))} disabled={running} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('screenMirror.viewOnly')}</span>
                <Switch checked={options.noControl} onChange={(v) => setOptions((o) => ({ ...o, noControl: v }))} disabled={running} />
              </div>
            </Space>
          </Card>

          {/* 设备信息 / Device info */}
          <Card title={t('screenMirror.deviceInfo')} size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('dashboard.device')}>{device.displayName}</Descriptions.Item>
              <Descriptions.Item label={t('dashboard.model')}>{device.model}</Descriptions.Item>
              <Descriptions.Item label={t('dashboard.android')}>{device.androidVersion}</Descriptions.Item>
              <Descriptions.Item label={t('dashboard.serial')}>{device.serial}</Descriptions.Item>
              <Descriptions.Item label={t('dashboard.battery')}>{device.batteryLevel}%</Descriptions.Item>
            </Descriptions>
          </Card>
        </div>
      </div>
    </>
  );
}
