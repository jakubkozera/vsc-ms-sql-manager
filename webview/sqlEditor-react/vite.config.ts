import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@components': resolve(import.meta.dirname, 'src/components'),
      '@context': resolve(import.meta.dirname, 'src/context'),
      '@hooks': resolve(import.meta.dirname, 'src/hooks'),
      '@types': resolve(import.meta.dirname, 'src/types'),
      '@services': resolve(import.meta.dirname, 'src/services'),
      '@styles': resolve(import.meta.dirname, 'src/styles'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sqlEditor: resolve(import.meta.dirname, 'index.html'),
        settings: resolve(import.meta.dirname, 'settings.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  // CSP-safe inline scripts disabled
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
