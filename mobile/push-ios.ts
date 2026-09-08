// iOS background ringing, stage 1: register this device's APNs token so
// the server can push "कॉल आ रहा है" when the app is closed. Tapping the
// push opens the app straight into the (still ringing) call screen.
// Stage 2 (CallKit VoIP) will replace the alert with a native ring.
import * as Notifications from 'expo-notifications'
import { APP_URL } from './config'

let registered: string | null = null

// a push that arrives with the app foregrounded should not banner over
// the in-app ring screen — the web app is already ringing loudly
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export async function registerIosPush(sessionToken: string): Promise<void> {
  if (!sessionToken) return
  try {
    const perm = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    })
    if (!perm.granted && perm.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return
    }
    const device = await Notifications.getDevicePushTokenAsync()
    const apnsToken = String(device.data)
    if (!apnsToken || apnsToken === registered) return
    const resp = await fetch(`${APP_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ token: apnsToken, platform: 'ios' }),
    })
    if (resp.ok) registered = apnsToken
  } catch {
    // no push is a degraded mode, never a crash
  }
}
