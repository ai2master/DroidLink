// Mock for @tauri-apps/api in test environment
export const invoke = async (_cmd: string, _args?: Record<string, unknown>) => null;

export const event = {
  listen: async (_event: string, _handler: (...args: unknown[]) => void) => {
    return () => {};
  },
  emit: async (_event: string, _payload?: unknown) => {},
  once: async (_event: string, _handler: (...args: unknown[]) => void) => {
    return () => {};
  },
};

export const window = {
  getCurrent: () => ({
    listen: async (_event: string, _handler: (...args: unknown[]) => void) => () => {},
    emit: async (_event: string, _payload?: unknown) => {},
  }),
  getAll: () => [],
};

export const path = {
  appDataDir: async () => '/tmp/droidlink-test',
  appConfigDir: async () => '/tmp/droidlink-test/config',
  resolveResource: async (path: string) => `/tmp/droidlink-test/resources/${path}`,
};
