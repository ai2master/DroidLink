import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Mock Tauri APIs for test environment
      '@tauri-apps/api': path.resolve(__dirname, 'src/__mocks__/tauri-api.ts'),
      '@tauri-apps/plugin-shell': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@tauri-apps/plugin-fs': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@tauri-apps/plugin-clipboard-manager': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@tauri-apps/plugin-notification': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@tauri-apps/plugin-process': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
      '@crabnebula/tauri-plugin-drag': path.resolve(__dirname, 'src/__mocks__/tauri-plugin.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__mocks__/**', 'src/__tests__/**', 'src/main.tsx'],
    },
  },
});
