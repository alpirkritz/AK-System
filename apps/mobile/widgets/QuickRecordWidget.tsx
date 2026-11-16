import { FlexWidget, TextWidget } from 'react-native-android-widget'

/**
 * Deep link the widget opens. `quick=1` makes the record screen start recording at once;
 * participants/project are asked after stopping (docs/specs/mobile-quick-record-widget-and-nav-fixes.md).
 */
export const QUICK_RECORD_URI = 'helm://record?quick=1'

/** Home-screen button: one tap → ARO opens already recording. Colours match lib/theme. */
export function QuickRecordWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: QUICK_RECORD_URI }}
      accessibilityLabel="הקלטה מהירה"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#0e1626',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#2dd4bf',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        padding: 8,
      }}
    >
      <FlexWidget
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: '#ef4444',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <FlexWidget style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff' }} />
      </FlexWidget>
      <TextWidget
        text="הקלטה מהירה"
        style={{ fontSize: 13, color: '#e2e8f0', marginTop: 6, fontWeight: '600' }}
      />
    </FlexWidget>
  )
}
