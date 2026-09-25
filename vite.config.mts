import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    // PRISMGIT_E2E_WEBSERVER: serve the RENDERER ONLY for the playwright
    // webServer (a11y audit) — no main-process build, no stray Electron
    // window fighting the tests for the DISPLAY.
    ...(process.env.PRISMGIT_E2E_WEBSERVER
      ? []
      : [
          electron({
            main: {
              // gitPollWorker.ts is the entry of the DEDICATED utilityProcess
              // that runs the repository-list remote check (status fetch) off
              // the main process's event loop — built to dist-electron/
              // gitPollWorker.js next to main.js (utilityProcess.fork loads
              // it from there, works inside the packaged asar too).
              entry: ['electron/main.ts', 'electron/services/gitPollWorker.ts'],
              vite: {
                // __BUILD_DATE__ is baked into the main-process bundle and shown
                // in the About window ("Build date" row).
                define: {
                  __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
                },
                build: {
                  outDir: 'dist-electron',
                  // chokidar@5 is ESM-only and simple-git is bundled into the
                  // main-process bundle by rolldown — only Electron + node
                  // builtins stay external (auto-handled).
                  rollupOptions: {
                    external: [
                      'electron',
                      'https',
                      'http',
                      'url',
                      'fs',
                      'path',
                      'os',
                    ],
                  },
                },
              },
            },
            preload: {
              input: 'electron/preload.ts',
              vite: {
                build: {
                  outDir: 'dist-electron',
                },
              },
            },
            renderer: {},
          }),
        ]),
  ],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Production: never ship source maps — cuts bundle ~3x and avoids
    // leaking original source to end users.
    sourcemap: false,
    // Vite 5 defaults to esbuild minify with target=modules. Make it explicit:
    target: 'es2020',
    cssCodeSplit: true,
    // 500kB is the rollup default; we now split vendor code, so we can go
    // back to the standard warning threshold and let the bundler surface
    // accidental bloat regressions.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
      },
      output: {
        // Split stable vendor code into separate chunks so app code changes
        // don't invalidate the long-term cache for React/zustand/router.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            if (id.includes('zustand')) return 'zustand';
            if (id.includes('@tauri-apps')) return 'tauri-vendor';
            if (id.includes('simple-git')) return 'simple-git';
          }
          // Pull the diff parser + git graph into a shared chunk — used by
          // History, Diff, Blame, Annotate, Investigate (5 lazy pages).
          if (id.includes('/src/lib/diffParser') || id.includes('/src/lib/gitGraph') || id.includes('/src/lib/graphAncestry')) {
            return 'git-utils';
          }
        },
        // Use a content-based hash for long-term caching.
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // oxc config (vite 8 replaced esbuild with oxc) — keep production builds
  // small by stripping `debugger` statements. We do NOT drop console.*
  // because the Command Log integration (electron/services/commandLog.ts)
  // wraps child_process.spawn — it does not call console.* directly, but
  // unrelated app code may legitimately use console.error/warn for runtime
  // diagnostics.
  oxc: {
    dropDebugger: process.env.NODE_ENV === 'production',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
