import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Two aliases reach outside this folder, both on purpose.
//
// `@sign` is the pose format the whole product shares — the app draws with
// it, Track B trains on it, and this platform captures into it. A copy here
// would eventually disagree with the original, and the disagreement would
// show up as a dataset that trains a figure into the wrong signing space.
//
// `@studio` is Track B's capture core. The landmark→canonical-space maths
// is the single thing that absolutely must not differ between a clip
// recorded in the studio and one recorded on a contributor's phone, because
// the two end up in the same training set.
export default defineConfig({
  resolve: {
    alias: {
      '@sign': fileURLToPath(new URL('../../frontend/src/lib/sign', import.meta.url)),
      '@studio': fileURLToPath(new URL('../../sign-studio/src/lib', import.meta.url)),
    },
  },
  server: {
    // host: true so the phone on the same wifi can open it — the whole
    // point of M1 is that the loop works on a real handset.
    host: true,
    port: 5190,
    fs: { allow: ['../..'] },
    proxy: { '/api': 'http://localhost:8100' },
  },
  plugins: [react()],
})
