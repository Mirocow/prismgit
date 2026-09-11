import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          // __BUILD_DATE__ is baked into the main-process bundle and shown
          // in the About window ("Build date" row).
          define: {
            __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
                'simple-git',
                'chokidar',
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
  ],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
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
        index: resolve(__dirname, 'index.html'),
      },
      output: {
        // Split stable vendor code into separate chunks so app code changes
        // don't invalidate the long-term cache for React/zustand/router.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'zustand': ['zustand'],
        },
        // Use a content-based hash for long-term caching.
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // esbuild config — keep production builds small by stripping `debugger`
  // statements. We do NOT drop console.* because the Command Log integration
  // (electron/services/commandLog.ts) wraps child_process.spawn — it does
  // not call console.* directly, but unrelated app code may legitimately
  // use console.error/warn for runtime diagnostics.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
