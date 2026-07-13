'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import {
  getOrCreatePushSubscription,
  installForegroundPushListener,
  showForegroundNotification,
} from '@/lib/push-client'

// ── localStorage keys (shared with ConflictsWidget and dashboard) ─────────────
import { LS } from '@/lib/ls-keys'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jerusalem',     label: 'ישראל (Asia/Jerusalem)' },
  { value: 'Europe/London',      label: 'לונדון (Europe/London)' },
  { value: 'Europe/Berlin',      label: 'ברלין (Europe/Berlin)' },
  { value: 'Europe/Paris',       label: 'פריז (Europe/Paris)' },
  { value: 'Europe/Athens',      label: 'אתונה (Europe/Athens)' },
  { value: 'America/New_York',   label: 'ניו יורק (America/New_York)' },
  { value: 'America/Chicago',    label: 'שיקגו (America/Chicago)' },
  { value: 'America/Denver',     label: 'דנוור (America/Denver)' },
  { value: 'America/Los_Angeles',label: 'לוס אנג׳לס (America/Los_Angeles)' },
  { value: 'Asia/Dubai',         label: 'דובאי (Asia/Dubai)' },
  { value: 'Asia/Kolkata',       label: 'הודו (Asia/Kolkata)' },
  { value: 'Asia/Tokyo',         label: 'טוקיו (Asia/Tokyo)' },
  { value: 'Asia/Shanghai',      label: 'סין (Asia/Shanghai)' },
  { value: 'Australia/Sydney',   label: 'סידני (Australia/Sydney)' },
  { value: 'Pacific/Auckland',   label: 'ניו זילנד (Pacific/Auckland)' },
  { value: 'UTC',                label: 'UTC' },
]

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors cursor-pointer"
      style={{
        background: checked ? '#e8c547' : '#2a2a2a',
        border: `1px solid ${checked ? '#e8c54766' : '#333'}`,
      }}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform shadow"
        style={{ transform: `translateX(${checked ? '19px' : '3px'})` }}
      />
    </button>
  )
}

function OptionGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className="text-[12px] px-3 py-1.5 rounded-lg transition-all cursor-pointer"
          style={{
            background: value === opt.value ? '#e8c54722' : '#1a1a1a',
            color:      value === opt.value ? '#e8c547'   : '#666',
            border:     `1px solid ${value === opt.value ? '#e8c54744' : '#222'}`,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: '#1a1a1a', border: '1px solid #222' }}
        >
          {icon}
        </div>
        <div>
          <div className="text-sm font-semibold text-[#ddd]">{title}</div>
          <div className="text-xs text-[#555] mt-0.5">{description}</div>
        </div>
      </div>
      <div className="card p-0 overflow-hidden divide-y divide-[#1a1a1a]">
        {children}
      </div>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#ccc]">{label}</div>
        {description && <div className="text-xs text-[#555] mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = TIMEZONE_OPTIONS.some((o) => o.value === value)
    ? TIMEZONE_OPTIONS
    : [{ value, label: value }, ...TIMEZONE_OPTIONS]

  return (
    <select
      className="select text-sm max-w-[220px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((tz) => (
        <option key={tz.value} value={tz.value}>{tz.label}</option>
      ))}
    </select>
  )
}

function CalendarCheckboxList({
  calendars,
  selected,
  onToggle,
}: {
  calendars: { id: string; name: string; color: string; source: string }[]
  selected: string[] | null
  onToggle: (id: string) => void
}) {
  const effective = selected ?? calendars.map((c) => c.id)

  if (calendars.length === 0) {
    return (
      <div className="px-5 py-3 text-xs text-[#555]">
        לא נמצאו יומנים — ודא שהיומן מחובר
      </div>
    )
  }

  return (
    <div className="px-5 py-3 flex flex-col gap-1">
      {calendars.map((cal) => {
        const checked = effective.includes(cal.id)
        return (
          <button
            key={cal.id}
            onClick={() => onToggle(cal.id)}
            className="flex items-center gap-2.5 py-1.5 rounded-lg hover:bg-[#1a1a1a] transition-colors text-right px-2"
          >
            <span
              className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-all"
              style={{
                background: checked ? cal.color : 'transparent',
                border: `2px solid ${checked ? cal.color : '#333'}`,
              }}
            >
              {checked && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1.5 4L3.5 6L6.5 2"
                    stroke="#000"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className={`text-xs flex-1 truncate text-right ${checked ? 'text-[#ccc]' : 'text-[#555]'}`}>
              {cal.name}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: cal.source === 'google' ? '#4285f422' : '#88888822',
                color: cal.source === 'google' ? '#4285f4' : '#888',
              }}
            >
              {cal.source === 'google' ? 'Google' : 'Exchange'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const PERSONAL_GOOGLE = 'alpirkritz@gmail.com'
const DAZ_GOOGLE = 'alpir@daz.guru'

function GoogleAccountsCard() {
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const { data, isLoading, refetch } = trpc.calendar.googleAccounts.useQuery()
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } =
    trpc.calendar.googleHealth.useQuery(undefined, {
      enabled: (data?.accounts.length ?? 0) > 0,
      refetchOnWindowFocus: true,
    })
  const [oauthMsg, setOauthMsg] = useState<string | null>(null)

  useEffect(() => {
    const connected = searchParams.get('google_connected')
    const email = searchParams.get('email')
    const err = searchParams.get('google_error')
    if (connected) {
      setOauthMsg(`חשבון ${email || 'Google'} חובר בהצלחה ✓`)
      void utils.calendar.googleAccounts.invalidate()
      void utils.calendar.googleHealth.invalidate()
      void refetch()
      void refetchHealth()
      window.history.replaceState({}, '', '/settings')
    } else if (err) {
      const messages: Record<string, string> = {
        no_refresh_token: 'Google לא החזיר refresh token — נסה שוב עם "הסרת גישה" מהחשבון ב-Google',
        insert_failed: 'שגיאה בשמירה ל-Supabase',
        missing_supabase_config: 'חסרה הגדרת Supabase בשרת — פנה למנהל המערכת',
        no_existing_user: 'לא נמצא חשבון — נסה שוב אחרי עדכון המערכת',
        oauth_failed: 'שגיאת OAuth — ודא ש-redirect URI רשום ב-Google Cloud Console',
      }
      setOauthMsg(messages[err] || `שגיאת חיבור: ${err}`)
      window.history.replaceState({}, '', '/settings')
    }
  }, [searchParams, refetch, refetchHealth, utils.calendar.googleAccounts, utils.calendar.googleHealth])

  const connected = new Set((data?.accounts ?? []).map((a) => a.email.toLowerCase()))
  const personalOk = connected.has(PERSONAL_GOOGLE)
  const dazOk = connected.has(DAZ_GOOGLE)

  const healthByEmail = new Map(
    (healthData?.accounts ?? []).map((a) => [a.email.toLowerCase(), a]),
  )

  function accountStatus(email: string, hasToken: boolean) {
    if (isLoading || (hasToken && healthLoading)) {
      return <span className="text-xs text-[#555]">בודק…</span>
    }
    if (!hasToken) {
      return (
        <a href={`/api/auth/google-calendar?hint=${encodeURIComponent(email)}`} className="btn btn-primary text-xs py-1.5 px-3">
          חבר
        </a>
      )
    }
    const health = healthByEmail.get(email.toLowerCase())
    if (!health || health.status === 'ok') {
      return <span className="text-xs text-[#47b86e]">פעיל ✓</span>
    }
    return (
      <div className="flex flex-col items-end gap-1 max-w-[220px]">
        <span className="text-xs text-red-400">שגיאת חיבור</span>
        <span className="text-[10px] text-[#666] text-left leading-snug">{health.error}</span>
        <a href={`/api/auth/google-calendar?hint=${encodeURIComponent(email)}`} className="btn btn-ghost text-[10px] py-1 px-2">
          חבר מחדש
        </a>
      </div>
    )
  }

  return (
    <Section
      icon={<span className="text-base">📧</span>}
      title="חשבונות Google"
      description="יומן + Gmail — חבר קודם את החשבון האישי, אחר כך את דאז"
    >
      {oauthMsg && (
        <div className="px-5 py-3 text-xs text-[#aaa] border-b border-[#1a1a1a]">{oauthMsg}</div>
      )}
      <Row label="אישי" description={PERSONAL_GOOGLE}>
        {accountStatus(PERSONAL_GOOGLE, personalOk)}
      </Row>
      <Row label="דאז" description={DAZ_GOOGLE}>
        {accountStatus(DAZ_GOOGLE, dazOk)}
      </Row>
      <div className="px-5 py-3 text-xs text-[#555] leading-relaxed">
        {connected.size === 0
          ? 'אין חשבונות מחוברים — לחץ "חבר" ואשר גישה ליומן ול-Gmail.'
          : `${connected.size} חשבון/ות רשומים. "פעיל" = Google Calendar API עובד בפועל.`}
      </div>
    </Section>
  )
}

interface NotionStatusData {
  configured: boolean
  accounts: Array<{
    label: string
    databases: Array<{ name: string; type: string; ok: boolean; error?: string }>
  }>
}

const NOTION_DB_TYPE_LABELS: Record<string, string> = {
  tasks: 'משימות',
  meetings: 'פגישות',
  assistant: 'Inbox',
}

function NotionCard() {
  const [data, setData] = useState<NotionStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/notion/status')
      const json = (await res.json()) as NotionStatusData & { error?: string }
      if (!res.ok || json.error) {
        setError(json.error || 'בדיקת החיבור נכשלה')
        setData(null)
      } else {
        setData(json)
      }
    } catch {
      setError('בדיקת החיבור נכשלה')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Section
      icon={<span className="text-base">🗂️</span>}
      title="Notion"
      description="חשבונות ובסיסי נתונים שהוגו קורא מהם — פגישות ומשימות"
    >
      {!data && !error && (
        <div className="px-5 py-3 text-xs text-[#555]">{loading ? 'בודק חיבור…' : 'טוען…'}</div>
      )}
      {error && <div className="px-5 py-3 text-xs text-[#e8474a]">{error}</div>}
      {data && !data.configured && (
        <div className="px-5 py-3 text-xs text-[#555] leading-relaxed">
          לא הוגדרו חשבונות Notion. הגדר <code className="text-[#aaa]">NOTION_ACCOUNTS</code> או{' '}
          <code className="text-[#aaa]">NOTION_API_KEY</code> בשרת.
        </div>
      )}
      {data?.configured &&
        data.accounts.map((acc) => (
          <div key={acc.label}>
            <div className="px-5 pt-4 pb-2 text-sm text-[#ccc]">{acc.label}</div>
            {acc.databases.length === 0 && (
              <div className="px-5 pb-3 text-xs text-[#555]">לא הוגדרו בסיסי נתונים לחשבון זה</div>
            )}
            {acc.databases.map((db) => (
              <div key={`${acc.label}:${db.name}`} className="flex items-start justify-between gap-4 px-5 py-2">
                <div className="min-w-0">
                  <div className="text-xs text-[#ccc] truncate">
                    {db.name}{' '}
                    <span className="text-[10px] text-[#666]">
                      ({NOTION_DB_TYPE_LABELS[db.type] ?? db.type})
                    </span>
                  </div>
                  {!db.ok && db.error && (
                    <div className="text-[11px] text-[#e8474a] mt-0.5 truncate">
                      {db.error} — שתף את הבסיס עם האינטגרציה ב-Notion
                    </div>
                  )}
                </div>
                <span className={`text-xs shrink-0 ${db.ok ? 'text-[#47b86e]' : 'text-[#e8474a]'}`}>
                  {db.ok ? 'מחובר ✓' : 'לא נגיש'}
                </span>
              </div>
            ))}
          </div>
        ))}
      <Row label="בדיקת חיבור" description="בדוק שכל בסיס נתונים משותף עם האינטגרציה">
        <button
          onClick={check}
          disabled={loading}
          className="btn btn-ghost text-[12px] py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'בודק…' : 'בדוק שוב'}
        </button>
      </Row>
    </Section>
  )
}

function NotificationsCard() {
  const { data: vapidKey } = trpc.push.getVapidPublicKey.useQuery()
  const subscribe = trpc.push.subscribe.useMutation()
  const sendTest = trpc.push.sendToAll.useMutation()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    installForegroundPushListener()
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission)
  }, [])

  async function enable() {
    setBusy(true)
    setStatus(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('הדפדפן לא תומך בנוטיפיקציות')
        return
      }
      if (!vapidKey) {
        setStatus('מפתחות VAPID לא מוגדרים בשרת')
        return
      }
      const sub = await getOrCreatePushSubscription(vapidKey)
      setPermission(Notification.permission)
      const json = sub.toJSON()
      if (json.endpoint && json.keys) {
        await subscribe.mutateAsync({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh!, auth: json.keys.auth! },
        })
      }
      setStatus('נוטיפיקציות הופעלו ✓')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'שגיאה בהפעלת נוטיפיקציות')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setStatus(null)
    const title = 'AK System'
    const body = 'נוטיפיקציית בדיקה ✓'
    const url = '/chat'
    try {
      const res = await sendTest.mutateAsync({ title, body, url })
      // Foreground fallback — Chrome on Mac often skips the OS banner when this tab is focused.
      showForegroundNotification(title, body, url)
      setStatus(`נשלח ל-${res.webSent ?? res.sent} PWA + ${res.expoSent ?? 0} Helm`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'שליחת בדיקה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const permLabel =
    permission === 'granted'
      ? 'מופעל ✓'
      : permission === 'denied'
        ? 'חסום בדפדפן'
        : permission === 'unsupported'
          ? 'לא נתמך'
          : 'כבוי'

  return (
    <Section
      icon={<span>🔔</span>}
      title="נוטיפיקציות"
      description="קבל התראות OS בטלפון — פומו, בריף בוקר, תזכורות, הוגו והסוכנים"
    >
      <Row label="התראות במכשיר הזה" description={`סטטוס: ${permLabel}`}>
        <button
          onClick={enable}
          disabled={busy || permission === 'unsupported'}
          className="btn btn-primary text-[12px] py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="enable-notifications"
        >
          {permission === 'granted' ? 'רענן רישום' : 'הפעל נוטיפיקציות'}
        </button>
      </Row>
      <Row label="בדיקת נוטיפיקציה" description="שלח התראת בדיקה לכל המכשירים הרשומים">
        <button
          onClick={test}
          disabled={busy || permission !== 'granted'}
          className="btn btn-ghost text-[12px] py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="test-notification"
        >
          שלח בדיקה
        </button>
      </Row>
      {status && (
        <div className="px-5 py-3 text-xs text-[#888]" data-testid="notifications-status">
          {status}
        </div>
      )}
    </Section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── state (hydrated from localStorage) ──────────────────────────────────────
  const [hydrated, setHydrated]                 = useState(false)
  const [conflictEnabled, setConflictEnabled]   = useState(true)
  const [conflictDays, setConflictDays]         = useState<number>(14)
  const [conflictCals, setConflictCals]         = useState<string[] | null>(null)
  const [syncCals, setSyncCals]                 = useState<string[] | null>(null)
  const [dismissedCount, setDismissedCount]     = useState(0)
  const [upcomingCount, setUpcomingCount]       = useState<number>(5)
  const [timezone, setTimezone]                 = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [savedFlash, setSavedFlash]             = useState(false)
  const [agentCals, setAgentCals]               = useState<string[] | null>(null)

  const { data: agentCalData } = trpc.settings.agentCalendars.get.useQuery(undefined, {
    enabled: hydrated,
  })
  const { data: catalogData, isFetching: catalogLoading } = trpc.calendar.catalog.useQuery(undefined, {
    enabled: hydrated,
  })
  const setAgentCalendars = trpc.settings.agentCalendars.set.useMutation({
    onSuccess: (data) => {
      setAgentCals(data.calendarIds)
      flash()
    },
  })

  useEffect(() => {
    if (agentCalData) setAgentCals(agentCalData.calendarIds)
  }, [agentCalData])

  useEffect(() => {
    setConflictEnabled(readLS(LS.CONFLICT_ENABLED, true))
    setConflictDays(parseInt(localStorage.getItem(LS.CONFLICT_DAYS) ?? '14') || 14)
    setConflictCals(readLS<string[] | null>(LS.CONFLICT_CALENDARS, null))
    setSyncCals(readLS<string[] | null>(LS.SYNC_CALENDARS, null))
    const dismissed = readLS<string[]>(LS.CONFLICT_DISMISSED, [])
    setDismissedCount(dismissed.length)
    setUpcomingCount(readLS(LS.DASHBOARD_UPCOMING, 5))
    const savedTz = readLS<string | null>(LS.TIMEZONE, null)
    if (savedTz) setTimezone(savedTz)
    setHydrated(true)
  }, [])

  // ── Calendar fetch (used for the calendar selector) ──────────────────────────
  const today   = new Date().toISOString().split('T')[0]
  const in14    = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: calData, isFetching: calLoading } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: in14 },
    { enabled: hydrated }
  )
  const calEvents = calData?.events ?? []

  const calendars = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; source: string }>()
    for (const ev of calEvents) {
      const id = ev.calendarId || 'unknown'
      if (!map.has(id)) {
        const isApple = id.startsWith('apple:')
        map.set(id, {
          id,
          name: ev.calendarName || (isApple ? 'Exchange' : id),
          color: ev.calendarColor || '#888',
          source: isApple ? 'apple' : 'google',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.source !== b.source) return a.source === 'google' ? -1 : 1
      return a.name.localeCompare(b.name, 'he')
    })
  }, [calEvents])

  const agentCatalog = useMemo(() => {
    const cals = catalogData?.calendars ?? []
    return cals.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      source: c.source,
      accountEmail: c.accountEmail,
    }))
  }, [catalogData])

  const agentCatalogGroups = useMemo(() => {
    const groups = new Map<string, typeof agentCatalog>()
    for (const cal of agentCatalog) {
      const key =
        cal.source === 'google'
          ? (cal.accountEmail ?? 'Google')
          : 'Exchange / Apple'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(cal)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'he'))
  }, [agentCatalog])

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function flash() {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  function set<T>(key: string, val: T, setter: (v: T) => void) {
    setter(val)
    writeLS(key, val)
    flash()
  }

  function setConflictDaysVal(d: number) {
    setConflictDays(d)
    localStorage.setItem(LS.CONFLICT_DAYS, String(d))
    flash()
  }

  function toggleCalendar(id: string) {
    const allIds  = calendars.map((c) => c.id)
    const current = conflictCals ?? allIds
    const next    = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id]
    const finalIds = next.length === allIds.length ? null : next
    setConflictCals(finalIds)
    writeLS(LS.CONFLICT_CALENDARS, finalIds ?? [])
    flash()
  }

  function toggleSyncCalendar(id: string) {
    const allIds  = calendars.map((c) => c.id)
    const current = syncCals ?? allIds
    const next    = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id]
    const finalIds = next.length === allIds.length ? null : next
    setSyncCals(finalIds)
    writeLS(LS.SYNC_CALENDARS, finalIds ?? [])
    flash()
  }

  function toggleAgentCalendar(id: string) {
    const allIds = agentCatalog.map((c) => c.id)
    if (allIds.length === 0) return
    const current = agentCals ?? allIds
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id]
    const finalIds = next.length === allIds.length ? null : next
    setAgentCals(finalIds)
    setAgentCalendars.mutate({ calendarIds: finalIds })
  }

  function clearDismissed() {
    localStorage.removeItem(LS.CONFLICT_DISMISSED)
    setDismissedCount(0)
    flash()
  }

  if (!hydrated) return null

  return (
    <div className="max-w-[640px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">הגדרות</h1>
          <p className="text-[#555] text-sm mt-1">התאמה אישית של המערכת</p>
        </div>
        <div
          className="text-[11px] px-2.5 py-1 rounded-full transition-all"
          style={{
            background: savedFlash ? '#47b86e22' : 'transparent',
            color: savedFlash ? '#47b86e' : 'transparent',
            border: `1px solid ${savedFlash ? '#47b86e44' : 'transparent'}`,
          }}
        >
          נשמר ✓
        </div>
      </div>

      <Link
        href="/settings/whatsapp"
        className="card p-4 mb-4 flex items-center justify-between gap-3 hover:border-[#25D36644] transition-colors"
        style={{ border: '1px solid #222' }}
      >
        <div>
          <div className="text-sm font-semibold text-[#ddd]">WhatsApp</div>
          <div className="text-xs text-[#555] mt-0.5">
            קבוצות, FOMO, מילות מפתח, סיכומים — הגדרות bridge
          </div>
        </div>
        <span className="text-[#25D366] text-lg">💬</span>
      </Link>

      <Link
        href="/memory"
        className="card p-4 mb-4 flex items-center justify-between gap-3 hover:border-[#e8c54744] transition-colors"
        style={{ border: '1px solid #222' }}
      >
        <div>
          <div className="text-sm font-semibold text-[#ddd]">זיכרון והוראות להוגו</div>
          <div className="text-xs text-[#555] mt-0.5">
            הוראות קבועות, זיכרונות וידע — נשמרים בין deployים ומוזרקים לכל שיחה
          </div>
        </div>
        <span className="text-[#e8c547] text-lg">🧠</span>
      </Link>

      {/* ── Section: Agent Calendars ─────────────────────────────────────────── */}
      <Section
        icon={
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3" width="16" height="15" rx="2" stroke="#e8c547" strokeWidth="1.5" />
            <path d="M6 2v3M14 2v3M2 8h16" stroke="#e8c547" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="13" r="2" stroke="#e8c547" strokeWidth="1.5" />
          </svg>
        }
        title="יומנים לסוכנים"
        description="הוגו, אופטי וסיכומי בוקר יתייחסו רק ליומנים שסימנת"
      >
        <div>
          <div className="px-5 pt-4 pb-2">
            <div className="text-sm text-[#ccc]">יומנים לניתוח</div>
            <div className="text-xs text-[#555] mt-0.5">
              כולל תתי-יומנים (למשל dragontail תחת alpirkritz@gmail.com). נשמר בשרת — עובד גם ב-WhatsApp.
            </div>
          </div>
          {catalogLoading ? (
            <div className="px-5 py-3 text-xs text-[#444]">טוען יומנים…</div>
          ) : agentCatalog.length === 0 ? (
            <div className="px-5 py-3 text-xs text-[#555]">לא נמצאו יומנים — ודא שהיומן מחובר</div>
          ) : (
            <div className="px-5 py-3 flex flex-col gap-3">
              {agentCatalogGroups.map(([group, cals]) => (
                <div key={group}>
                  <div className="text-[10px] text-[#444] uppercase tracking-wider font-medium mb-1 px-2">
                    {group}
                  </div>
                  <CalendarCheckboxList
                    calendars={cals}
                    selected={agentCals}
                    onToggle={toggleAgentCalendar}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Suspense fallback={null}>
        <GoogleAccountsCard />
      </Suspense>

      {/* ── Section: Notion ──────────────────────────────────────────────────── */}
      <NotionCard />

      {/* ── Section: Notifications ───────────────────────────────────────────── */}
      <Link
        href="/settings/notifications"
        className="card p-4 mb-4 flex items-center justify-between gap-3 hover:border-[#e8c54744] transition-colors"
        style={{ border: '1px solid #222' }}
      >
        <div>
          <div className="text-sm font-semibold text-[#ddd]">התראות וערוצים</div>
          <div className="text-xs text-[#555] mt-0.5">
            מה נשלח ומתי — הפעלה או כיבוי לכל ערוץ (WhatsApp / פוש / Telegram) ושעות לתדריכים
          </div>
        </div>
        <span className="text-[#e8c547] text-lg">🔔</span>
      </Link>

      <NotificationsCard />

      {/* ── Section: Calendar Conflicts ──────────────────────────────────────── */}
      <Section
        icon={
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 4v4l3 3"
              stroke="#e8474a"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
        title="התנגשויות ביומן"
        description="ניהול בדיקת חפיפות בין אירועים בלוח הזמנים"
      >
        {/* Enable toggle */}
        <Row
          label="הצג התנגשויות בדשבורד"
          description="סרגל ייעודי יוצג בדף הבית כשיש חפיפות"
        >
          <Toggle
            checked={conflictEnabled}
            onChange={(v) => set(LS.CONFLICT_ENABLED, v, setConflictEnabled)}
          />
        </Row>

        {/* Days range */}
        <Row label="טווח בדיקה" description="כמה ימים קדימה לחפש התנגשויות">
          <OptionGroup
            options={[
              { label: '7 ימים', value: 7 },
              { label: '14 ימים', value: 14 },
              { label: '30 ימים', value: 30 },
            ]}
            value={conflictDays}
            onChange={setConflictDaysVal}
          />
        </Row>

        {/* Calendar selector */}
        <div>
          <div className="px-5 pt-4 pb-2">
            <div className="text-sm text-[#ccc]">יומנים לבדיקה</div>
            <div className="text-xs text-[#555] mt-0.5">
              סמן אילו יומנים לכלול בבדיקת ההתנגשויות ובספירת הפגישות בדשבורד
            </div>
          </div>
          {calLoading ? (
            <div className="px-5 py-3 text-xs text-[#444]">טוען יומנים…</div>
          ) : (
            <CalendarCheckboxList
              calendars={calendars}
              selected={conflictCals}
              onToggle={toggleCalendar}
            />
          )}
        </div>

        {/* Clear dismissed */}
        <Row
          label="התנגשויות שהתעלמתי מהן"
          description={
            dismissedCount > 0
              ? `${dismissedCount} התנגשויות מוסתרות`
              : 'אין התנגשויות מוסתרות'
          }
        >
          <button
            onClick={clearDismissed}
            disabled={dismissedCount === 0}
            className="btn btn-ghost text-[12px] py-1 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            נקה הכל
          </button>
        </Row>
      </Section>

      {/* ── Section: Dashboard ───────────────────────────────────────────────── */}
      <Section
        icon={
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="#e8c547" strokeWidth="1.5" />
            <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="#e8c547" strokeWidth="1.5" />
            <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="#e8c547" strokeWidth="1.5" />
            <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="#e8c547" strokeWidth="1.5" />
          </svg>
        }
        title="דשבורד"
        description="התאמת תצוגת מרכז הבקרה"
      >
        <Row
          label="מספר פגישות קרובות"
          description="כמה פגישות להציג בלוח הבקרה"
        >
          <OptionGroup
            options={[
              { label: '3', value: 3 },
              { label: '5', value: 5 },
              { label: '10', value: 10 },
            ]}
            value={upcomingCount}
            onChange={(v) => set(LS.DASHBOARD_UPCOMING, v, setUpcomingCount)}
          />
        </Row>

        <Row
          label="אזור זמן"
          description={`השעה כרגע: ${new Date().toLocaleTimeString('he-IL', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })}`}
        >

          <TimezoneSelect value={timezone} onChange={(v) => set(LS.TIMEZONE, v, setTimezone)} />
        </Row>
      </Section>

      {/* ── Section: Meeting Sync ─────────────────────────────────────────────── */}
      <Section
        icon={
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3" width="16" height="15" rx="2" stroke="#47b8e8" strokeWidth="1.5" />
            <path d="M6 2v3M14 2v3M2 8h16" stroke="#47b8e8" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M6 12h8M6 15h5" stroke="#47b8e8" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
        title="סנכרון פגישות"
        description="בחר מאיזה יומנים לייבא פגישות אוטומטית לדף הפגישות"
      >
        <div>
          <div className="px-5 pt-4 pb-2">
            <div className="text-sm text-[#ccc]">יומנים לסנכרון</div>
            <div className="text-xs text-[#555] mt-0.5">
              רק פגישות מיומנים מסומנים ייובאו בעת לחיצה על ״סנכרן מיומן״
            </div>
          </div>
          {calLoading ? (
            <div className="px-5 py-3 text-xs text-[#444]">טוען יומנים…</div>
          ) : (
            <CalendarCheckboxList
              calendars={calendars}
              selected={syncCals}
              onToggle={toggleSyncCalendar}
            />
          )}
        </div>
      </Section>
    </div>
  )
}
