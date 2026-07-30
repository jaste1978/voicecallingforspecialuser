import * as Haptics from 'expo-haptics'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { PermissionsAndroid, Platform, StyleSheet, Vibration, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { APP_URL } from './config'
import { resumeRingServiceIfLoggedIn, setRingToken } from './ring-service'

const RING_PATTERN = [0, 600, 300, 600, 300, 600, 300, 600]

function handleNativeMessage(msg: string) {
  if (msg.startsWith('auth:')) {
    // web app hands over (or clears) the session token so the background
    // ring service can watch for calls with the app closed
    void setRingToken(msg.slice(5))
    return
  }
  switch (msg) {
    case 'ring':
      // repeat until cancelled — keeps vibrating as long as it rings
      Vibration.vibrate(RING_PATTERN, true)
      break
    case 'ring_stop':
      Vibration.cancel()
      break
    case 'haptic:connect':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      break
    case 'haptic:speech':
      // caller started speaking — a firm tap says "look at the screen"
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      break
    case 'haptic:caption':
      void Haptics.selectionAsync()
      break
    case 'haptic:end':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      break
  }
}

export default function App() {
  useEffect(() => {
    // the page's getUserMedia needs the app-level mic permission on Android
    if (Platform.OS === 'android') {
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      // phone restarted / app relaunched: bring the call watch back up
      void resumeRingServiceIfLoggedIn()
    }
  }, [])

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <WebView
        source={{
          uri: APP_URL,
          headers: { 'ngrok-skip-browser-warning': '1' },
        }}
        style={styles.web}
        // let getUserMedia work without an extra in-page permission dialog
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        // native bridge: the web app posts events, the shell reacts natively
        onMessage={(e) => handleNativeMessage(e.nativeEvent.data)}
        originWhitelist={['https://*', 'http://*']}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF8F1' },
  web: { flex: 1, backgroundColor: '#FFF8F1' },
})
