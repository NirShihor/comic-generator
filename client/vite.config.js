import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API server to proxy to. VITE_API_TARGET lets a second checkout (a
// feature worktree) run against its own server on another port.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
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
      '/uploads': API_TARGET,
      '/projects': API_TARGET,
    }
  }
})
