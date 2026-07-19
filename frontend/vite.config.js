import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/documents': 'http://localhost:8000',
      '/adaptive': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/multimodal': 'http://localhost:8000',
      '/index': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
    },
  }
})
