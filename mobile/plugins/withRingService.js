// Expo config plugin: Android manifest bits for the background ring service.
// react-native-background-actions runs a foreground service; Android 14+
// requires an explicit foregroundServiceType on it, and Android 13+ needs
// the POST_NOTIFICATIONS permission for the incoming-call alert.
const { withAndroidManifest } = require('@expo/config-plugins')

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS',
]

module.exports = function withRingService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

    manifest['uses-permission'] = manifest['uses-permission'] || []
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } })
      }
    }

    const app = manifest.application?.[0]
    if (app) {
      app.service = app.service || []
      const NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask'
      let svc = app.service.find((s) => s.$['android:name'] === NAME)
      if (!svc) {
        svc = { $: { 'android:name': NAME } }
        app.service.push(svc)
      }
      svc.$['android:foregroundServiceType'] = 'dataSync'
      svc.$['tools:replace'] = 'android:foregroundServiceType'
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'
    }

    return cfg
  })
}
