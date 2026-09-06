import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Both aliases point at src/vendor, which holds generated copies of the
// pose format (the app's) and the landmark extraction maths (Track B's).
//
// Those two files must not differ from their originals — a clip recorded on
// a contributor's phone and one recorded in the studio land in the same
// training set, so a divergence would be a systematic error nobody could
// see. They are copies rather than imports because this service deploys on
// its own from committed code, and both originals still live in another
// track's uncommitted working tree. `npm run sync` refreshes them and the
// build's --check step fails if they have drifted.
export default defineConfig({
  resolve: {
    alias: {
      '@sign': fileURLToPath(new URL('./src/vendor', import.meta.url)),
      '@studio': fileURLToPath(new URL('./src/vendor', import.meta.url)),
    },
  },
  server: {
    // host: true so the phone on the same wifi can open it — the whole
    // point of M1 is that the loop works on a real handset.
    host: true,
    port: 5190,
    proxy: { '/api': 'http://localhost:8100' },
  },
  plugins: [react()],
})
