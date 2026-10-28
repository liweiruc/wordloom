import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The iPad web app (npm run dev:web / build:web): the Windows app's renderer, with src/web in
// place of Electron. The build is plain static files, served from GitHub Pages under a
// sub-path, hence the relative base.
export default defineConfig({
  root: resolve('src/web'),
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Wordloom',
        short_name: 'Wordloom',
        description: '背单词：挖空拼写，复习时间由 FSRS 遗忘曲线安排。',
        lang: 'zh-CN',
        display: 'standalone',
        start_url: './',
        scope: './',
        background_color: '#f6f5f2',
        theme_color: '#f6f5f2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Everything the app needs offline, SQLite's .wasm included.
        globPatterns: ['**/*.{js,css,html,wasm,png,webmanifest}'],
        // Workers that sqlite-wasm ships but the app never starts: the Worker1 API, and the
        // proxy of its other OPFS storage, which needs cross-origin isolation.
        globIgnores: ['**/sqlite3-worker1-*.js', '**/sqlite3-opfs-async-proxy-*.js'],
        // Workbox leaves out files over 2 MB, which would quietly break offline use once a
        // bundle grows that big (the worker's is about 1.1 MB).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
      }
    })
  ],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    // Its loader finds sqlite3.wasm next to itself, which pre-bundling would break.
    exclude: ['@sqlite.org/sqlite-wasm']
  },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
  }
})
