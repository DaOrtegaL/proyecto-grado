import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // El proxy mantiene el mismo origen para la cookie de refresco (SameSite=Strict).
    proxy: { '/api': { target: process.env.VITE_API_URL ?? 'http://localhost:3000', changeOrigin: true } },
  },
});
