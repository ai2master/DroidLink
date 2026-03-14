import { create } from 'zustand';

export interface DeviceInfo {
  serial: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: string;
  batteryLevel: number;
  storageTotal: number;
  storageUsed: number;
  displayName: string;
}

export interface SyncStatus {
  type: string;
  serial: string;
  dataType: string;
  itemsSynced?: number;
  current?: number;
  total?: number;
  message?: string;
}

export type Density = 'compact' | 'comfortable';

interface AppStore {
  // 多设备支持 / Multi-device support
  connectedDevices: DeviceInfo[];
  activeDeviceSerial: string | null;
  addDevice: (device: DeviceInfo) => void;
  removeDevice: (serial: string) => void;
  setActiveDevice: (serial: string | null) => void;

  // 向后兼容 / Backward compatibility (computed from multi-device state)
  connectedDevice: DeviceInfo | null;
  setConnectedDevice: (device: DeviceInfo | null) => void;

  // Companion app 安装状态 (按设备) / Per-device companion status
  companionStatuses: Record<string, boolean | null>;
  companionInstalled: boolean | null; // computed: active device's status
  setCompanionInstalled: (installed: boolean | null) => void;

  // Current page
  currentPage: string;
  setCurrentPage: (page: string) => void;

  // Sync status
  syncStatuses: Record<string, SyncStatus>;
  updateSyncStatus: (status: SyncStatus) => void;

  // Settings
  settings: Record<string, string>;
  setSettings: (settings: Record<string, string>) => void;
  updateSetting: (key: string, value: string) => void;

  // Clipboard
  clipboardContent: string;
  setClipboardContent: (content: string) => void;

  // Display density
  density: Density;
  setDensity: (density: Density) => void;

  // Show companion install prompt (triggered from pages that need it)
  showCompanionPrompt: boolean;
  setShowCompanionPrompt: (show: boolean) => void;
}

const getInitialDensity = (): Density => {
  try {
    return (localStorage.getItem('droidlink-density') as Density) || 'compact';
  } catch {
    return 'compact';
  }
};

// 获取当前活跃设备 / Get active device from state
const getActiveDevice = (state: { connectedDevices: DeviceInfo[]; activeDeviceSerial: string | null }): DeviceInfo | null => {
  if (!state.activeDeviceSerial) return null;
  return state.connectedDevices.find((d) => d.serial === state.activeDeviceSerial) || null;
};

// 计算活跃设备的 companion 状态 / Compute companion status for active device
const getCompanionInstalled = (state: { activeDeviceSerial: string | null; companionStatuses: Record<string, boolean | null> }): boolean | null => {
  if (!state.activeDeviceSerial) return null;
  return state.companionStatuses[state.activeDeviceSerial] ?? null;
};

export const useStore = create<AppStore>((set, get) => ({
  // 多设备状态 / Multi-device state
  connectedDevices: [],
  activeDeviceSerial: null,

  addDevice: (device) =>
    set((state) => {
      // 去重：如果已存在则更新设备信息 / Deduplicate: update if serial exists
      const exists = state.connectedDevices.some((d) => d.serial === device.serial);
      const devices = exists
        ? state.connectedDevices.map((d) => (d.serial === device.serial ? device : d))
        : [...state.connectedDevices, device];
      // 如果没有活跃设备，自动选择新设备 / Auto-select if no active device
      const activeSerial = state.activeDeviceSerial || device.serial;
      const activeDevice = getActiveDevice({ connectedDevices: devices, activeDeviceSerial: activeSerial });
      return {
        connectedDevices: devices,
        activeDeviceSerial: activeSerial,
        connectedDevice: activeDevice,
        companionInstalled: getCompanionInstalled({ activeDeviceSerial: activeSerial, companionStatuses: state.companionStatuses }),
      };
    }),

  removeDevice: (serial) =>
    set((state) => {
      const devices = state.connectedDevices.filter((d) => d.serial !== serial);
      let activeSerial = state.activeDeviceSerial;
      // 如果移除的是活跃设备，自动切换到下一个 / If removed is active, switch to next
      if (activeSerial === serial) {
        activeSerial = devices[0]?.serial || null;
      }
      // 清除该设备的 companion 状态 / Clear companion status for this device
      const { [serial]: _, ...remainingStatuses } = state.companionStatuses;
      return {
        connectedDevices: devices,
        activeDeviceSerial: activeSerial,
        connectedDevice: getActiveDevice({ connectedDevices: devices, activeDeviceSerial: activeSerial }),
        companionStatuses: remainingStatuses,
        companionInstalled: getCompanionInstalled({ activeDeviceSerial: activeSerial, companionStatuses: remainingStatuses }),
      };
    }),

  setActiveDevice: (serial) =>
    set((state) => {
      const device = serial ? state.connectedDevices.find((d) => d.serial === serial) || null : null;
      return {
        activeDeviceSerial: serial,
        connectedDevice: device,
        companionInstalled: getCompanionInstalled({ activeDeviceSerial: serial, companionStatuses: state.companionStatuses }),
      };
    }),

  // 向后兼容：connectedDevice 作为 activeDevice 的别名
  // Backward compat: connectedDevice is alias for activeDevice
  connectedDevice: null,
  setConnectedDevice: (device) => {
    if (device) {
      get().addDevice(device);
    } else {
      // 清除所有设备（断开连接时保持原有行为）
      // Clear all devices (keep original disconnect behavior)
    }
  },

  // Companion 状态 (按设备) / Per-device companion status
  companionStatuses: {},
  companionInstalled: null,
  setCompanionInstalled: (installed) =>
    set((state) => {
      if (!state.activeDeviceSerial) return {};
      const newStatuses = {
        ...state.companionStatuses,
        [state.activeDeviceSerial]: installed,
      };
      return {
        companionStatuses: newStatuses,
        companionInstalled: installed,
      };
    }),

  currentPage: 'dashboard',
  setCurrentPage: (page) => set({ currentPage: page }),

  syncStatuses: {},
  updateSyncStatus: (status) =>
    set((state) => ({
      syncStatuses: {
        ...state.syncStatuses,
        [`${status.serial}_${status.dataType}`]: status,
      },
    })),

  settings: {},
  setSettings: (settings) => set({ settings }),
  updateSetting: (key, value) =>
    set((state) => ({ settings: { ...state.settings, [key]: value } })),

  clipboardContent: '',
  setClipboardContent: (content) => set({ clipboardContent: content }),

  density: getInitialDensity(),
  setDensity: (density) => {
    localStorage.setItem('droidlink-density', density);
    document.documentElement.setAttribute('data-density', density);
    set({ density });
  },

  showCompanionPrompt: false,
  setShowCompanionPrompt: (show) => set({ showCompanionPrompt: show }),
}));
