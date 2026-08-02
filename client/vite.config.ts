import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Mounted under /todolist by the server extension in server/index.ts. The base
// keeps its asset URLs (/todolist/assets/*) clear of the other apps served by
// the same shell.
export default defineConfig({
  root: __dirname,
  base: '/todolist/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/todolist/api': 'http://localhost:8000',
    },
  },
  build: {
    outDir: path.resolve(__dirname, './dist'),
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'react/jsx-runtime'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
