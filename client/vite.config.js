import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        timeout: 600000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.socket?.setTimeout(600000);
          });
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.socket?.setTimeout(600000);
          });
        },
      },
      '/uploads': 'http://localhost:3001',
      '/projects': 'http://localhost:3001',
    }
  }
})
