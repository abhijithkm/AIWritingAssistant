import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Content scripts are bundled one at a time as IIFEs: `vite build` for Writer, `--mode meet` for Meet.
const scripts = {
  writer: { entry: 'src/content/content.ts', name: 'AIWriterContent', file: 'content.js' },
  meet: { entry: 'src/meet/meet-content.ts', name: 'AIWriterMeetContent', file: 'meet-content.js' },
};

export default defineConfig(({ mode }) => {
  const script = mode === 'meet' ? scripts.meet : scripts.writer;
  return {
    configFile: false,
    // The popup build already copies public/ to dist/. Without this, each content script build copies it again into dist/assets.
    publicDir: false,
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(script.entry),
        name: script.name,
        formats: ['iife'],
        fileName: () => script.file,
      },
      outDir: resolve(__dirname, 'dist/assets'),
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  };
});
