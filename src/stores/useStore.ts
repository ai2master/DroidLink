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
  // Device state
  connectedDevice: DeviceInfo | null;
  setConnectedDevice: (device: DeviceInfo | null) => void;

  // Companion app installed state (null = not checked yet)
  companionInstalled: boolean | null;
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

export const useStore = create<AppStore>((set) => ({
  connectedDevice: null,
  setConnectedDevice: (device) => set({ connectedDevice: device, companionInstalled: device ? null : null }),

  companionInstalled: null,
  setCompanionInstalled: (installed) => set({ companionInstalled: installed }),

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
