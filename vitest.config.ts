/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/lib/**',
        'src/stores/**',
        'electron/services/git.ts',
      ],
      exclude: [
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/lib/distributedReviews.ts',
        'src/lib/smartViews.ts',
        'src/lib/overlap.ts',
        'src/lib/useContextMenu.ts',
        'src/lib/authorBadges.ts',
        'src/stores/authStore.ts',
        'src/stores/gitStore.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 55,
        lines: 50,
      },
    },
  },
});
