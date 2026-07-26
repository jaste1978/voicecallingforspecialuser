import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Vibration, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { APP_URL } from './config'

const RING_PATTERN = [0, 600, 300, 600, 300, 600, 300, 600]

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
        onMessage={(e) => {
          const msg = e.nativeEvent.data
          if (msg === 'ring') Vibration.vibrate(RING_PATTERN)
          else if (msg === 'ring_stop') Vibration.cancel()
        }}
        originWhitelist={['https://*', 'http://*']}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
})
