'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  calendarId?: string
  calendarName?: string
  calendarColor?: string
  htmlLink?: string | null
  rsvp?: string
}

interface ConflictPair {
  eventA: CalEvent
  eventB: CalEvent
  overlapStart: string
  overlapEnd: string
}

// localStorage keys — also used by settings page
const LS_ENABLED   = 'ak:conflict-enabled'
const LS_DAYS      = 'ak:conflict-days'
const LS_CALENDARS = 'ak:conflict-calendars'
const LS_DISMISSED = 'ak:conflict-dismissed'

function conflictKey(a: string, b: string) {
  return [a, b].sort().join('|')
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function overlapMinutes(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

function isGoogleEvent(ev: CalEvent) {
  return ev.calendarId && !ev.calendarId.startsWith('apple:')
}

function calColor(ev: CalEvent): string {
  return ev.calendarColor || '#888'
}

function isoDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

// ── Single conflict card ───────────────────────────────────────────────────────

function ConflictCard({
  conflict,
  onDismiss,
  onDecline,
  decliningId,
}: {
  conflict: ConflictPair
  onDismiss: () => void
  onDecline: (ev: CalEvent) => void
  decliningId: string | null
}) {
  const { eventA, eventB, overlapStart, overlapEnd } = conflict
  const mins = overlapMinutes(overlapStart, overlapEnd)

  return (
    <div
      className="rounded-xl border border-[#2a1a1a] mb-3"
      style={{ background: 'rgba(232,71,74,0.04)' }}
    >
      {/* Overlap banner */}
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-t-xl border-b border-[#2a1a1a]"
        style={{ background: 'rgba(232,71,74,0.07)' }}
      >
        <span className="text-[11px] font-semibold text-[#e8474a]">
          חפיפה · {mins} דק׳
        </span>
        <span className="text-[11px] text-[#666]">
          {fmtDate(overlapStart)} {fmtTime(overlapStart)}–{fmtTime(overlapEnd)}
        </span>
      </div>

      {/* Two events */}
      <div className="p-3 flex flex-col gap-2">
        {([eventA, eventB] as CalEvent[]).map((ev) => (
          <div
            key={ev.id}
            className="flex items-start gap-2.5 p-2.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.025)' }}
          >
            <div
              className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
              style={{ background: calColor(ev) }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[#ddd] truncate">{ev.title}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-[#666]">
                  {fmtTime(ev.start)}–{fmtTime(ev.end)}
                </span>
                {ev.calendarName && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: calColor(ev) + '22',
                      color: calColor(ev),
                    }}
                  >
                    {ev.calendarName}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
        <button className="btn btn-ghost text-[12px] py-1 px-3" onClick={onDismiss}>
          התעלם
        </button>

        {([eventA, eventB] as CalEvent[])
          .filter((ev) => isGoogleEvent(ev) && ev.htmlLink)
          .slice(0, 1)
          .map((ev) => (
            <a
              key={ev.id + '-open'}
              href={ev.htmlLink!}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost text-[12px] py-1 px-3 inline-flex items-center gap-1 no-underline"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path
                  d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3m0 0v3m0-3L5 7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              פתח ביומן
            </a>
          ))}

        {([eventA, eventB] as CalEvent[])
          .filter((ev) => isGoogleEvent(ev) && ev.calendarId)
          .map((ev) => (
            <button
              key={ev.id + '-decline'}
              className="btn text-[12px] py-1 px-3"
              style={{
                background: 'rgba(232,71,74,0.12)',
                color: '#e8474a',
                border: '1px solid rgba(232,71,74,0.25)',
                borderRadius: 8,
              }}
              disabled={decliningId === ev.id}
              onClick={() => onDecline(ev)}
            >
              {decliningId === ev.id ? '...' : `דחה — ${ev.title.slice(0, 20)}`}
            </button>
          ))}
      </div>
    </div>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────────

export function ConflictsWidget() {
  const [enabled, setEnabled]               = useState(true)
  const [days, setDays]                     = useState(14)
  const [selectedCalIds, setSelectedCalIds] = useState<string[] | null>(null)
  const [dismissed, setDismissed]           = useState<Set<string>>(new Set())
  const [decliningId, setDecliningId]       = useState<string | null>(null)
  const [hydrated, setHydrated]             = useState(false)

  useEffect(() => {
    try {
      const en  = localStorage.getItem(LS_ENABLED)
      if (en !== null) setEnabled(JSON.parse(en) !== false)
      const d   = localStorage.getItem(LS_DAYS)
      if (d) setDays(parseInt(d) || 14)
      const c   = localStorage.getItem(LS_CALENDARS)
      if (c) setSelectedCalIds(JSON.parse(c))
      const dis = localStorage.getItem(LS_DISMISSED)
      if (dis) setDismissed(new Set(JSON.parse(dis)))
    } catch { /* ignore */ }
    setHydrated(true)
  }, [])

  const startDate = isoDateStr(new Date())
  const endDate   = isoDateStr(new Date(Date.now() + days * 86400000))

  const {
    data: rawConflicts = [],
    isLoading,
    refetch,
  } = trpc.calendar.conflicts.useQuery(
    { startDate, endDate, calendarIds: selectedCalIds ?? undefined },
    { enabled: hydrated && enabled }
  )

  const declineMutation = trpc.calendar.declineEvent.useMutation({
    onSuccess: () => { refetch(); setDecliningId(null) },
    onError:   () => setDecliningId(null),
  })

  const visibleConflicts = useMemo(
    () =>
      (rawConflicts as ConflictPair[]).filter(
        (c) => !dismissed.has(conflictKey(c.eventA.id, c.eventB.id))
      ),
    [rawConflicts, dismissed]
  )

  function handleDismiss(eventAId: string, eventBId: string) {
    const key  = conflictKey(eventAId, eventBId)
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    localStorage.setItem(LS_DISMISSED, JSON.stringify([...next]))
  }

  function handleDecline(ev: CalEvent) {
    if (!ev.calendarId) return
    setDecliningId(ev.id)
    declineMutation.mutate({ eventId: ev.id, calendarId: ev.calendarId })
  }

  if (!hydrated || !enabled) return null
  if (isLoading && visibleConflicts.length === 0) return null

  const count = visibleConflicts.length

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-xs font-semibold text-[#666] uppercase tracking-wider">
          התנגשויות ביומן
        </div>
        {count > 0 && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(232,71,74,0.2)', color: '#e8474a' }}
          >
            {count}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-[#444]">{days} יום קדימה</span>
        <Link
          href="/settings"
          className="text-[#444] hover:text-[#888] transition-colors p-1 rounded"
          title="הגדרות התנגשויות"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            />
          </svg>
        </Link>
      </div>

      {/* No conflicts */}
      {count === 0 && (
        <div className="card py-3 px-4 text-sm text-[#555] flex items-center gap-2">
          <span className="text-green-500 text-base">✓</span>
          אין התנגשויות ב-{days} הימים הקרובים
        </div>
      )}

      {/* Conflict list */}
      {count > 0 && (
        <div>
          {visibleConflicts.map((c) => (
            <ConflictCard
              key={conflictKey(c.eventA.id, c.eventB.id)}
              conflict={c}
              onDismiss={() => handleDismiss(c.eventA.id, c.eventB.id)}
              onDecline={handleDecline}
              decliningId={decliningId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
