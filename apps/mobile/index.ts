// Custom entry: expo-router plus the Android home-screen widget task handler.
import 'expo-router/entry'
import { Platform } from 'react-native'
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import { widgetTaskHandler } from './widgets/widget-task-handler'

if (Platform.OS === 'android') {
  registerWidgetTaskHandler(widgetTaskHandler)
}
