// Background "call watch": a foreground service holding a lightweight
// websocket to /ws/ring so incoming calls ring even when the phone is
// locked or the app is in the background. No audio flows here — the
// WebView handles the actual call once the user opens the app.

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { AppState, Vibration } from 'react-native'
import BackgroundService from 'react-native-background-actions'
import { APP_URL } from './config'

const TOKEN_KEY = 'sunosathi.token'
const RING_PATTERN = [0, 600, 300, 600, 300, 600, 300, 600]
const PING_MS = 25000
const RECONNECT_MS = 4000

let ringNotificationId: string | null = null

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function ensureNotificationSetup(): Promise<void> {
  await Notifications.requestPermissionsAsync()
  await Notifications.setNotificationChannelAsync('incoming-calls', {
    name: 'Incoming calls',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: RING_PATTERN,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    sound: 'default',
  })
}

async function showRingNotification(from: string): Promise<void> {
  const res = await Notifications.scheduleNotificationAsync({
    content: {
      title: '📞 Incoming call',
      body: `${from} is calling — tap to answer and read live`,
      sticky: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      sound: 'default',
    },
    trigger: { channelId: 'incoming-calls' },
  })
  ringNotificationId = res
}

async function clearRingNotification(): Promise<void> {
  Vibration.cancel()
  if (ringNotificationId) {
    await Notifications.dismissNotificationAsync(ringNotificationId).catch(() => {})
    ringNotificationId = null
  }
}

function ringWsUrl(token: string): string {
  return `${APP_URL.replace(/^http/, 'ws')}/ws/ring?token=${encodeURIComponent(token)}`
}

async function watchLoop(): Promise<void> {
  // runs inside the foreground service until stopRingService()
  while (BackgroundService.isRunning()) {
    const token = await AsyncStorage.getItem(TOKEN_KEY)
    if (!token) {
      await new Promise((r) => setTimeout(r, RECONNECT_MS))
      continue
    }
    await new Promise<void>((resolve) => {
      let ping: ReturnType<typeof setInterval> | null = null
      let ws: WebSocket
      try {
        ws = new WebSocket(ringWsUrl(token))
      } catch {
        resolve()
        return
      }
      const done = () => {
        if (ping) clearInterval(ping)
        resolve()
      }
      ws.onopen = () => {
        ping = setInterval(() => {
          try { ws.send('{"type":"ping"}') } catch { /* closing */ }
        }, PING_MS)
      }
      ws.onmessage = (e) => {
        let msg: { type?: string; from?: string }
        try { msg = JSON.parse(String(e.data)) } catch { return }
        if (msg.type === 'ring') {
          // foreground app already rings via the WebView bridge
          if (AppState.currentState !== 'active') {
            Vibration.vibrate(RING_PATTERN, true)
            void showRingNotification(msg.from || 'Someone')
          }
        } else if (msg.type === 'call_started' || msg.type === 'call_ended') {
          void clearRingNotification()
        }
      }
      ws.onerror = () => { try { ws.close() } catch { /* already closed */ } }
      ws.onclose = done
    })
    await clearRingNotification()
    await new Promise((r) => setTimeout(r, RECONNECT_MS))
  }
}

export async function setRingToken(token: string): Promise<void> {
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token)
    await startRingService()
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY)
    await stopRingService()
  }
}

export async function startRingService(): Promise<void> {
  if (BackgroundService.isRunning()) return
  await ensureNotificationSetup()
  await BackgroundService.start(async () => watchLoop(), {
    taskName: 'SunoSathiRing',
    taskTitle: 'SunoSathi is on duty',
    taskDesc: 'Your calls will ring here — even with the screen off',
    taskIcon: { name: 'ic_launcher', type: 'mipmap' },
    color: '#E4590A',
    linkingURI: 'sunosathi://',
  })
}

export async function stopRingService(): Promise<void> {
  await clearRingNotification()
  if (BackgroundService.isRunning()) await BackgroundService.stop()
}

export async function resumeRingServiceIfLoggedIn(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY)
  if (token) await startRingService()
}
