import type { ReactNode } from 'react'
import { useRef } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'
import { KeyboardSafe } from './KeyboardSafe'
import { colors } from '../lib/theme'

type Props = {
  /** Sheet header title (Hebrew). */
  title: string
  /** Header save action. Omit to render a read-only sheet with no save button. */
  onSave?: () => void
  saving?: boolean
  saveDisabled?: boolean
  saveLabel?: string
  savingLabel?: string
  /** Defaults to router.back(). */
  onCancel?: () => void
  cancelLabel?: string
  children: ReactNode
}

/**
 * Common scaffold for formSheet screens (the task/[id] pattern): header with
 * save/cancel actions + a scroll body that stays above the keyboard.
 */
export function FormSheetScaffold({
  title,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = 'שמור',
  savingLabel = 'שומר…',
  onCancel,
  cancelLabel = 'ביטול',
  children,
}: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scrollRef = useRef<ScrollView>(null)
  const cancel = onCancel ?? (() => router.back())

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: onSave
            ? () => (
                <Pressable
                  onPress={onSave}
                  disabled={saving || saveDisabled}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={saveLabel}
                >
                  <Text
                    style={[
                      styles.headerAction,
                      (saving || saveDisabled) && styles.headerActionDisabled,
                    ]}
                  >
                    {saving ? savingLabel : saveLabel}
                  </Text>
                </Pressable>
              )
            : undefined,
          headerLeft: () => (
            <Pressable
              onPress={cancel}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.headerAction}>{cancelLabel}</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardSafe style={styles.flex} scrollRef={scrollRef}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator
        >
          {children}
        </ScrollView>
      </KeyboardSafe>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 8 },
  headerAction: { color: colors.accent, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  headerActionDisabled: { color: colors.textMuted },
})
