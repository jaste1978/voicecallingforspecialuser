// App-global call connection. The socket must outlive the Calls page —
// otherwise browsing to Contacts/Settings disconnects the user and
// incoming rings have nowhere to land.

import { connectCall, type CallClient, type CallEvent } from './call-client'
import { getToken } from './auth'

interface Handlers {
  onEvent: (e: CallEvent) => void
  onAudio: (pcm: ArrayBuffer) => void
  onStatus: (up: boolean) => void
}

let client: CallClient | null = null
let handlers: Handlers | null = null
let lastStatus = false
let liveRing: CallEvent | null = null // a ring not yet consumed by the UI
const ringWatchers = new Set<(e: CallEvent) => void>()

function ensure() {
  if (client || !getToken()) return
  client = connectCall(
    (e) => {
      if (e.type === 'ring') {
        liveRing = e
        ringWatchers.forEach((w) => w(e))
      } else if (e.type === 'call_ended' || e.type === 'call_started') {
        liveRing = null
      }
      handlers?.onEvent(e)
    },
    (pcm) => handlers?.onAudio(pcm),
    (up) => {
      lastStatus = up
      handlers?.onStatus(up)
    },
  )
}

export const callStore = {
  /** The Calls page attaches while mounted; the socket stays up regardless. */
  attach(h: Handlers): () => void {
    ensure()
    handlers = h
    h.onStatus(lastStatus)
    if (liveRing) h.onEvent(liveRing) // replay a ring that arrived off-page
    return () => {
      if (handlers === h) handlers = null
    }
  },
  /** App-level: navigate to the call screen when a ring lands anywhere. */
  onRing(w: (e: CallEvent) => void): () => void {
    ensure()
    ringWatchers.add(w)
    return () => {
      ringWatchers.delete(w)
    }
  },
  client(): CallClient | null {
    ensure()
    return client
  },
}
