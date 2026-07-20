import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // 开启相对路径，确保 Electron file:// 协议下正确加载 JS/CSS 资源
  plugins: [react()],
})
