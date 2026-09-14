import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep dependency prebundling enabled in the browser preview. React is
  // published as CommonJS while lucide-react imports named React exports;
  // Vite's optimizer supplies the ESM interop required by the live app.
  server: {
    port: 4173,
    host: '127.0.0.1',
  },
});
