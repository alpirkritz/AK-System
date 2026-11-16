import type { WidgetTaskHandlerProps } from 'react-native-android-widget'
import { QuickRecordWidget } from './QuickRecordWidget'

const widgets = {
  QuickRecord: QuickRecordWidget,
} as const

/**
 * Renders home-screen widgets. Clicks use OPEN_URI (handled natively by Android),
 * so there is nothing to do on WIDGET_CLICK.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const Widget = widgets[props.widgetInfo.widgetName as keyof typeof widgets]
  if (!Widget) return
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<Widget />)
      break
    default:
      break
  }
}
