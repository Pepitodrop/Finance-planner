import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const CONNECTOR_URL = 'http://127.0.0.1:8788'
const proxy = {
  '/api': CONNECTOR_URL,
  '/health/ready': CONNECTOR_URL,
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
