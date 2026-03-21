import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, type DeviceInfo, type CompanionStatus } from './useStore';

const makeDevice = (serial: string, model = 'Pixel'): DeviceInfo => ({
  serial,
  model,
  manufacturer: 'Google',
  androidVersion: '14',
  sdkVersion: '34',
  batteryLevel: 85,
  storageTotal: 128_000_000_000,
  storageUsed: 64_000_000_000,
  displayName: `${model} (${serial})`,
});

describe('useStore - multi-device management', () => {
  beforeEach(() => {
    useStore.setState({
      connectedDevices: [],
      activeDeviceSerial: null,
      connectedDevice: null,
      companionStatuses: {},
      companionInstalled: null,
      companionNeedsUpdate: false,
      companionDeviceVersion: '',
      companionBundledVersion: '',
      syncStatuses: {},
      settings: {},
      clipboardContent: '',
      currentPage: 'dashboard',
      showCompanionPrompt: false,
    });
  });

  it('adds a device and auto-selects it', () => {
    const device = makeDevice('ABC123');
    useStore.getState().addDevice(device);

    const state = useStore.getState();
    expect(state.connectedDevices).toHaveLength(1);
    expect(state.activeDeviceSerial).toBe('ABC123');
    expect(state.connectedDevice?.serial).toBe('ABC123');
  });

  it('does not duplicate devices with same serial', () => {
    const device1 = makeDevice('ABC123', 'Pixel 7');
    const device2 = makeDevice('ABC123', 'Pixel 7 Pro');
    useStore.getState().addDevice(device1);
    useStore.getState().addDevice(device2);

    const state = useStore.getState();
    expect(state.connectedDevices).toHaveLength(1);
    expect(state.connectedDevices[0].model).toBe('Pixel 7 Pro');
  });

  it('adds multiple devices, keeps first as active', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().addDevice(makeDevice('DEV2'));

    const state = useStore.getState();
    expect(state.connectedDevices).toHaveLength(2);
    expect(state.activeDeviceSerial).toBe('DEV1');
  });

  it('switches active device', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().addDevice(makeDevice('DEV2'));
    useStore.getState().setActiveDevice('DEV2');

    expect(useStore.getState().activeDeviceSerial).toBe('DEV2');
    expect(useStore.getState().connectedDevice?.serial).toBe('DEV2');
  });

  it('removes a device and auto-selects next', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().addDevice(makeDevice('DEV2'));
    useStore.getState().removeDevice('DEV1');

    const state = useStore.getState();
    expect(state.connectedDevices).toHaveLength(1);
    expect(state.activeDeviceSerial).toBe('DEV2');
  });

  it('removes last device, sets active to null', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().removeDevice('DEV1');

    expect(useStore.getState().connectedDevices).toHaveLength(0);
    expect(useStore.getState().activeDeviceSerial).toBeNull();
    expect(useStore.getState().connectedDevice).toBeNull();
  });
});

describe('useStore - companion status', () => {
  beforeEach(() => {
    useStore.setState({
      connectedDevices: [],
      activeDeviceSerial: null,
      connectedDevice: null,
      companionStatuses: {},
      companionInstalled: null,
      companionNeedsUpdate: false,
      companionDeviceVersion: '',
      companionBundledVersion: '',
    });
  });

  it('sets companion status per device', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    const status: CompanionStatus = {
      installed: true,
      deviceVersion: '2.0.42',
      bundledVersion: '2.0.42',
      needsUpdate: false,
      protocolVersion: 1,
      deviceProtocolVersion: 1,
    };
    useStore.getState().setCompanionStatus('DEV1', status);

    const state = useStore.getState();
    expect(state.companionInstalled).toBe(true);
    expect(state.companionNeedsUpdate).toBe(false);
    expect(state.companionDeviceVersion).toBe('2.0.42');
  });

  it('reports needsUpdate when protocol version mismatch', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().setCompanionStatus('DEV1', {
      installed: true,
      deviceVersion: '1.0.50',
      bundledVersion: '2.0.42',
      needsUpdate: true,
      protocolVersion: 2,
      deviceProtocolVersion: 1,
    });

    expect(useStore.getState().companionNeedsUpdate).toBe(true);
  });

  it('clears companion status when device removed', () => {
    useStore.getState().addDevice(makeDevice('DEV1'));
    useStore.getState().setCompanionStatus('DEV1', {
      installed: true,
      deviceVersion: '2.0.42',
      bundledVersion: '2.0.42',
      needsUpdate: false,
    });
    useStore.getState().removeDevice('DEV1');

    expect(useStore.getState().companionStatuses).not.toHaveProperty('DEV1');
    expect(useStore.getState().companionInstalled).toBeNull();
  });
});

describe('useStore - sync status', () => {
  it('updates sync status by serial+dataType key', () => {
    useStore.getState().updateSyncStatus({
      type: 'progress',
      serial: 'DEV1',
      dataType: 'contacts',
      itemsSynced: 50,
      current: 50,
      total: 100,
    });

    const statuses = useStore.getState().syncStatuses;
    expect(statuses['DEV1_contacts']).toBeDefined();
    expect(statuses['DEV1_contacts'].itemsSynced).toBe(50);
  });
});

describe('useStore - settings', () => {
  it('sets and updates settings', () => {
    useStore.getState().setSettings({ theme: 'dark', lang: 'zh' });
    expect(useStore.getState().settings.theme).toBe('dark');

    useStore.getState().updateSetting('theme', 'light');
    expect(useStore.getState().settings.theme).toBe('light');
    expect(useStore.getState().settings.lang).toBe('zh');
  });
});

describe('useStore - page navigation', () => {
  it('sets current page', () => {
    useStore.getState().setCurrentPage('contacts');
    expect(useStore.getState().currentPage).toBe('contacts');
  });
});

describe('useStore - clipboard', () => {
  it('sets clipboard content', () => {
    useStore.getState().setClipboardContent('hello world');
    expect(useStore.getState().clipboardContent).toBe('hello world');
  });
});
