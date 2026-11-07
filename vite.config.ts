import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    watch: {
      ignored: ['**/qa/**', '**/.tmp/**', '**/dist/**', '**/*.tmp', '**/*.tmpdir/**', '**/.*.tmpdir/**'],
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1600 },
});
