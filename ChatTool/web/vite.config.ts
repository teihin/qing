import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'CHAT_')
  const apiTarget = env.CHAT_DEV_API_TARGET || 'http://127.0.0.1:8893'
  return {
    base: env.CHAT_PUBLIC_PATH || '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 7460,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          headers: { Origin: new URL(apiTarget).origin },
        },
      },
    },
    build: { outDir: 'dist', sourcemap: false },
  }
})
