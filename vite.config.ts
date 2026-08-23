import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'map-engine': ['maplibre-gl', 'd3-geo'],
          'react-core': ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  server: {
    port: 4173,
    host: '127.0.0.1',
  },
});
