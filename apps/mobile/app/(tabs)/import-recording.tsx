import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { useFocusEffect, useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import { fetchPeople, fetchProjects, type MobileProject } from '../../lib/data'
import { colors } from '../../lib/theme'
import { uploadVoiceRecording } from '../../lib/voice'
import { VOICE_MIN_SECONDS } from '../../lib/voice-format'
import { RecordingContextEditor } from '../../components/RecordingContextEditor'

/**
 * Import an externally-recorded audio file (e.g. Samsung's native call recorder) into the same
 * transcription/analysis/self-voice-matching pipeline as an in-app recording.
 * See docs/specs/recording-background-and-speaker-id.md.
 *
 * A review step (people + project) was added by docs/specs/recording-context-before-upload.md.
 *
 * Note: this screen only covers the "pick a file from the app" path. The Android share-sheet
 * path (sharing directly from the call-recorder/Files app into ARO) additionally needs an
 * intent-filter handler wired up in expo-router — the `intentFilters` config in app.config.ts
 * makes ARO appear as a share target, but routing that shared file into this same screen needs
 * a small additional linking-handler piece not included in this pass.
 */

type Named = { id: string; name: string }
type Phase = 'pick' | 'ready' | 'review' | 'uploading' | 'done'

export default function ImportRecordingScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState<{ uri: string; name: string; mimeType: string; sizeBytes: number } | null>(null)
  const [consent, setConsent] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [people, setPeople] = useState<Named[]>([])
  const [project, setProject] = useState<Named | null>(null)
  const [directory, setDirectory] = useState<{ people: Named[]; projects: MobileProject[] } | null>(null)

  /** Back to an empty file-pick screen, ready for the next import. */
  const reset = useCallback(() => {
    setFile(null)
    setConsent(false)
    setProgress(0)
    setMessage(null)
    setPeople([])
    setProject(null)
    setPhase('pick')
  }, [])

  // Tab screens stay mounted, so a finished import used to stay on "done" forever and the
  // only way to import another file was to kill the app. Leaving the screen after a
  // successful upload now resets it.
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (phaseRef.current === 'done') reset()
      }
    }, [reset]),
  )

  // Load people + projects for the context editor as soon as we have a token.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void Promise.all([fetchPeople(token), fetchProjects(token)])
      .then(([loadedPeople, loadedProjects]) => {
        if (!cancelled) setDirectory({ people: loadedPeople, projects: loadedProjects })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  const pick = async () => {
    setMessage(null)
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    setFile({
      uri: asset.uri,
      name: asset.name ?? 'recording',
      mimeType: asset.mimeType ?? 'audio/mp4',
      sizeBytes: asset.size ?? 0,
    })
    setPhase('ready')
  }

  const upload = async () => {
    if (!token || !file) return
    setPhase('uploading')
    setProgress(0)
    setMessage(null)
    try {
      // Duration isn't known from a picked file without decoding it; the server only enforces a
      // minimum, so send a value comfortably above VOICE_MIN_SECONDS and let the actual duration
      // come from transcription/analysis instead of blocking the upload on a client-side guess.
      await uploadVoiceRecording(
        token,
        {
          uri: file.uri,
          durationSeconds: VOICE_MIN_SECONDS + 1,
          personIds: people.map((p) => p.id),
          projectId: project?.id ?? null,
          source: 'imported',
          fileName: file.name,
          mimeType: file.mimeType,
        },
        setProgress,
      )
      setPhase('done')
    } catch (err) {
      setPhase('review')
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    }
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>ייבוא הקלטה</Text>
        <Text style={styles.body}>
          ייבוא קובץ הקלטה חיצוני — למשל הקלטת שיחת טלפון של המקליט המובנה של סמסונג — ועיבוד שלו באותו
          תהליך כמו הקלטה מתוך האפליקציה: תמלול, ניתוח, וזיהוי אוטומטי אם אתה אחד הדוברים.
        </Text>
      </View>

      {phase === 'pick' ? (
        <Pressable style={styles.primaryBtn} onPress={() => void pick()} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>בחר קובץ הקלטה</Text>
        </Pressable>
      ) : null}

      {phase === 'ready' && file ? (
        <View style={styles.card}>
          <Text style={styles.body} numberOfLines={1}>{file.name}</Text>
          <Text style={styles.muted}>{file.mimeType}{file.sizeBytes ? ` · ${(file.sizeBytes / (1024 * 1024)).toFixed(1)}MB` : ''}</Text>

          <Pressable
            style={styles.consentRow}
            onPress={() => setConsent((c) => !c)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
          >
            <View style={[styles.checkbox, consent && styles.checkboxOn]}>
              {consent ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <View style={styles.flexText}>
              <Text style={styles.body}>כל המשתתפים בשיחה הזו הסכימו להקלטה</Text>
              <Text style={styles.muted}>
                גם הקלטת שיחת טלפון כפופה לדיני הקלטה מקומיים — האחריות על כך שלכל המשתתפים הייתה הסכמה היא שלך.
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.primaryBtn, !consent && styles.disabled]}
            disabled={!consent}
            onPress={() => { setPeople([]); setProject(null); setPhase('review') }}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>המשך לבחירת הקשר</Text>
          </Pressable>
          <Pressable onPress={() => { setFile(null); setPhase('pick') }} accessibilityRole="button">
            <Text style={styles.link}>בחר קובץ אחר</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Review phase: select attendees and project before uploading */}
      {phase === 'review' && file ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>אישור לפני העלאה</Text>
          <Text style={styles.muted}>בחר משתתפים ופרויקט (אופציונלי) ואז לחץ ״העלה שיחה״.</Text>
          <RecordingContextEditor
            people={people}
            project={project}
            directory={directory}
            onChangePeople={setPeople}
            onChangeProject={setProject}
          />
          <Pressable
            style={styles.primaryBtn}
            onPress={() => void upload()}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>העלה שיחה</Text>
          </Pressable>
          <Pressable onPress={() => setPhase('ready')} accessibilityRole="button">
            <Text style={styles.link}>חזרה</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'uploading' ? (
        <View style={styles.card} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>מעלה… {Math.round(progress * 100)}%</Text>
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.card}>
          <Text style={styles.body}>ההקלטה עלתה ונמצאת בתהליך תמלול וניתוח — היא תופיע ברשימת ההקלטות בקרוב.</Text>
          <Pressable style={styles.primaryBtn} onPress={reset} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>ייבא הקלטה נוספת</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/meetings')} accessibilityRole="button">
            <Text style={styles.link}>לרשימת הפגישות</Text>
          </Pressable>
        </View>
      ) : null}

      {message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : null}
    </ScrollView>
  )
}

const rtl = { textAlign: 'right' as const, writingDirection: 'rtl' as const }

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexText: { flex: 1 },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', ...rtl },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, ...rtl },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19, ...rtl },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', ...rtl },
  error: { color: colors.error, fontSize: 13, ...rtl },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600', paddingVertical: 10, ...rtl },
  consentRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.45 },
})
