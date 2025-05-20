import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/video2gif/',                    // tells Vite to prefix asset paths
  build: { outDir: '../video2gif' },      // puts files in repoRoot/video2gif/
  plugins: [react()],
});
