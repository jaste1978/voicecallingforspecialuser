// Lets plain `node` import Track B's phrases.ts, which reaches into the app
// via the `@app/*` alias that only Vite knows about. Node 22+ strips the
// types itself; this hook is only about making the alias resolve.

import { pathToFileURL } from 'node:url'
import { resolve as resolvePath, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_LIB = resolvePath(HERE, '../../frontend/src/lib')
const SIGN_LIB = resolvePath(HERE, '../../frontend/src/lib/sign')

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@app/')) {
    return next(pathToFileURL(resolvePath(APP_LIB, specifier.slice(5) + '.ts')).href, context)
  }
  if (specifier.startsWith('@sign/')) {
    return next(pathToFileURL(resolvePath(SIGN_LIB, specifier.slice(6) + '.ts')).href, context)
  }
  return next(specifier, context)
}
