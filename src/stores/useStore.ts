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

export interface CompanionStatus {
  installed: boolean;
  deviceVersion: string;
  bundledVersion: string;
  needsUpdate: boolean;
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
  companionStatuses: Record<string, CompanionStatus | null>;
  companionInstalled: boolean | null; // computed: active device's status
  companionNeedsUpdate: boolean; // computed: active device needs companion update
  companionDeviceVersion: string; // computed: active device's companion version
  companionBundledVersion: string; // computed: bundled companion version
  setCompanionInstalled: (installed: boolean | null) => void;
  setCompanionStatus: (serial: string, status: CompanionStatus) => void;

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
const getCompanionInstalled = (state: { activeDeviceSerial: string | null; companionStatuses: Record<string, CompanionStatus | null> }): boolean | null => {
  if (!state.activeDeviceSerial) return null;
  const status = state.companionStatuses[state.activeDeviceSerial];
  if (!status) return null;
  return status.installed;
};

// 计算活跃设备的 companion 更新状态 / Compute companion update fields for active device
const getCompanionFields = (state: { activeDeviceSerial: string | null; companionStatuses: Record<string, CompanionStatus | null> }) => {
  if (!state.activeDeviceSerial) {
    return { companionNeedsUpdate: false, companionDeviceVersion: '', companionBundledVersion: '' };
  }
  const status = state.companionStatuses[state.activeDeviceSerial];
  if (!status) {
    return { companionNeedsUpdate: false, companionDeviceVersion: '', companionBundledVersion: '' };
  }
  return {
    companionNeedsUpdate: status.needsUpdate,
    companionDeviceVersion: status.deviceVersion,
    companionBundledVersion: status.bundledVersion,
  };
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
        ...getCompanionFields({ activeDeviceSerial: activeSerial, companionStatuses: state.companionStatuses }),
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
        ...getCompanionFields({ activeDeviceSerial: activeSerial, companionStatuses: remainingStatuses }),
      };
    }),

  setActiveDevice: (serial) =>
    set((state) => {
      const device = serial ? state.connectedDevices.find((d) => d.serial === serial) || null : null;
      return {
        activeDeviceSerial: serial,
        connectedDevice: device,
        companionInstalled: getCompanionInstalled({ activeDeviceSerial: serial, companionStatuses: state.companionStatuses }),
        ...getCompanionFields({ activeDeviceSerial: serial, companionStatuses: state.companionStatuses }),
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
  companionNeedsUpdate: false,
  companionDeviceVersion: '',
  companionBundledVersion: '',

  setCompanionInstalled: (installed) =>
    set((state) => {
      if (!state.activeDeviceSerial) return {};
      // 更新现有状态或创建新状态 / Update existing status or create new
      const existing = state.companionStatuses[state.activeDeviceSerial];
      const newStatus: CompanionStatus = existing
        ? { ...existing, installed: !!installed, needsUpdate: false }
        : { installed: !!installed, deviceVersion: '', bundledVersion: '', needsUpdate: false };
      const newStatuses = {
        ...state.companionStatuses,
        [state.activeDeviceSerial]: newStatus,
      };
      return {
        companionStatuses: newStatuses,
        companionInstalled: installed,
        ...getCompanionFields({ activeDeviceSerial: state.activeDeviceSerial, companionStatuses: newStatuses }),
      };
    }),

  setCompanionStatus: (serial, status) =>
    set((state) => {
      const newStatuses = {
        ...state.companionStatuses,
        [serial]: status,
      };
      return {
        companionStatuses: newStatuses,
        companionInstalled: getCompanionInstalled({ activeDeviceSerial: state.activeDeviceSerial, companionStatuses: newStatuses }),
        ...getCompanionFields({ activeDeviceSerial: state.activeDeviceSerial, companionStatuses: newStatuses }),
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
