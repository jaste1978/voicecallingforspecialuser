import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

let version = 'dev'
try {
  version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()
} catch {
  /* VERSION file optional */
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // marketing site + backend endpoints must never be hijacked by the
        // app shell's navigation fallback
        navigateFallbackDenylist: [/^\/welcome/, /^\/site/, /^\/about/, /^\/api/, /^\/vobiz/, /^\/ws/, /^\/ios/, /^\/guide/],
      },
      manifest: {
        name: 'SunoSathi — Hearing Helper',
        short_name: 'SunoSathi',
        description: 'Live captions and captioned phone calls for deaf and hard-of-hearing users',
        theme_color: '#FFF8F1',
        background_color: '#FFF8F1',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true, // reachable from phone on LAN
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000' },
    },
  },
})
