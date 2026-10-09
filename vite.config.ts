import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function copyManifest(): Plugin {
  return {
    name: 'copy-extension-manifest',
    closeBundle() {
      mkdirSync(resolve('dist'), { recursive: true });
      copyFileSync(resolve('manifest.json'), resolve('dist/manifest.json'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifest()],
  publicDir: 'public',
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve('index.html'),
        report: resolve('report.html'),
        panel: resolve('panel.html'),
        window: resolve('window.html'),
        'service-worker': resolve('src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
