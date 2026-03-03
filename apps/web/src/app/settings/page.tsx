'use client'

import { useState, useEffect, useMemo } from 'react'
import { trpc } from '@/lib/trpc'

// ── localStorage keys (shared with ConflictsWidget and dashboard) ─────────────
import { LS } from '@/lib/ls-keys'

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
  const [savedFlash, setSavedFlash]             = useState(false)

  useEffect(() => {
    setConflictEnabled(readLS(LS.CONFLICT_ENABLED, true))
    setConflictDays(parseInt(localStorage.getItem(LS.CONFLICT_DAYS) ?? '14') || 14)
    setConflictCals(readLS<string[] | null>(LS.CONFLICT_CALENDARS, null))
    setSyncCals(readLS<string[] | null>(LS.SYNC_CALENDARS, null))
    const dismissed = readLS<string[]>(LS.CONFLICT_DISMISSED, [])
    setDismissedCount(dismissed.length)
    setUpcomingCount(readLS(LS.DASHBOARD_UPCOMING, 5))
    setHydrated(true)
  }, [])

  // ── Calendar fetch (used for the calendar selector) ──────────────────────────
  const today   = new Date().toISOString().split('T')[0]
  const in14    = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: calEvents = [], isFetching: calLoading } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: in14 },
    { enabled: hydrated }
  )

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
