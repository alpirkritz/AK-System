'use client'

import { useEffect, useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const CALENDAR_OPTIMIZER_AGENT_ID = '06_calendar_optimizer'

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: checked ? '#2dd4bf' : '#2f4368',
        border: `1px solid ${checked ? '#2dd4bf66' : '#3a507d'}`,
      }}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform shadow"
        style={{ transform: `translateX(${checked ? '19px' : '3px'})` }}
      />
    </button>
  )
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'עדיין לא רץ'
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function sortTimes(times: string[]): string[] {
  return [...new Set(times)].sort()
}

interface AgentConfigPanelProps {
  agentId: string
}

/**
 * Single place to configure how an agent is triggered: a clock schedule, system
 * events, or both. Everything here is data — a new card in A_Agents/ shows up
 * without a code change.
 */
export function AgentConfigPanel({ agentId }: AgentConfigPanelProps) {
  const utils = trpc.useUtils()
  // No focus refetch: this is an edit form, and a background refresh would reset
  // the draft below.
  const { data, isLoading, error } = trpc.agents.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  })

  const [enabled, setEnabled] = useState(false)
  const [times, setTimes] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [triggerMessage, setTriggerMessage] = useState('')
  const [newTime, setNewTime] = useState('')
  const [timeError, setTimeError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  // Calendar optimizer: per-time day offsets (0=today, 1=tomorrow)
  const [dayOffsets, setDayOffsets] = useState<Record<string, 0 | 1>>({})
  const [newTimeOffset, setNewTimeOffset] = useState<0 | 1>(0)

  const config = data?.agents.find((a) => a.agentId === agentId)
  const eventCatalog = data?.events ?? []
  const agentNameById = useMemo(
    () => new Map((data?.agents ?? []).map((a) => [a.agentId, a.name])),
    [data?.agents],
  )

  // Resync the draft when the server state or the selected agent changes. Status is
  // deliberately left alone: this effect also runs on the refetch that follows a
  // save, and clearing it here would wipe the confirmation the user just earned.
  useEffect(() => {
    if (!config) return
    setEnabled(config.enabled)
    setTimes(sortTimes(config.scheduleTimes))
    setEvents([...config.subscribedEvents].sort())
    setTriggerMessage(config.triggerMessage ?? '')
    setNewTime('')
    setTimeError(null)
    setDayOffsets((config.scheduleDayOffsets as Record<string, 0 | 1>) ?? {})
    setNewTimeOffset(0)
  }, [config?.agentId, config?.enabled, config?.scheduleTimes.join(','), config?.subscribedEvents.join(','), config?.triggerMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setStatus(null)
  }, [agentId])

  const setSchedule = trpc.agents.setSchedule.useMutation()
  const setEventSubscription = trpc.agents.setEventSubscription.useMutation()
  const run = trpc.agents.run.useMutation({
    onSuccess: (res) => {
      void utils.agents.list.invalidate()
      setStatus(
        res.ok
          ? { kind: 'ok', text: 'הסוכן סיים — התוצאה נשלחה להתראות' }
          : { kind: 'error', text: res.error ?? 'ההרצה נכשלה' },
      )
    },
    onError: (e) => setStatus({ kind: 'error', text: e.message }),
  })

  const savedTimes = sortTimes(config?.scheduleTimes ?? [])
  const savedEvents = [...(config?.subscribedEvents ?? [])].sort()
  const dirty =
    !!config &&
    (enabled !== config.enabled ||
      times.join(',') !== savedTimes.join(',') ||
      events.join(',') !== savedEvents.join(',') ||
      triggerMessage.trim() !== (config.triggerMessage ?? '').trim() ||
      (agentId === CALENDAR_OPTIMIZER_AGENT_ID &&
        JSON.stringify(dayOffsets) !== JSON.stringify((config.scheduleDayOffsets ?? {}) as Record<string, 0 | 1>)))

  function addTime(raw: string) {
    const value = raw.trim()
    if (!TIME_PATTERN.test(value)) {
      setTimeError('פורמט שעה: HH:MM (למשל 07:00)')
      return
    }
    if (times.includes(value)) {
      setTimeError('השעה כבר ברשימה')
      return
    }
    setTimes(sortTimes([...times, value]))
    if (agentId === CALENDAR_OPTIMIZER_AGENT_ID && newTimeOffset === 1) {
      setDayOffsets((prev) => ({ ...prev, [value]: 1 }))
    }
    setNewTime('')
    setTimeError(null)
  }

  async function handleSave() {
    if (!config || !dirty) return
    setSaving(true)
    setStatus(null)
    try {
      await setSchedule.mutateAsync({
        agentId,
        enabled,
        scheduleTimes: times,
        triggerMessage: triggerMessage.trim() || null,
        ...(agentId === CALENDAR_OPTIMIZER_AGENT_ID ? { scheduleDayOffsets: dayOffsets } : {}),
      })

      for (const typeId of eventCatalog.map((e) => e.typeId)) {
        const before = savedEvents.includes(typeId)
        const after = events.includes(typeId)
        if (before !== after) {
          await setEventSubscription.mutateAsync({ agentId, typeId, subscribed: after })
        }
      }

      await utils.agents.list.invalidate()
      setStatus({ kind: 'ok', text: 'ההגדרות נשמרו' })
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : 'שמירת ההגדרות נכשלה',
      })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-[#5a688c]">טוען הגדרות...</div>
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        שגיאה בטעינת ההגדרות: {error.message}
      </div>
    )
  }

  if (!config) {
    return <div className="p-6 text-sm text-[#5a688c]">לא נמצאו הגדרות לסוכן הזה</div>
  }

  const continuous = config.continuous
  const canEnable = continuous || times.length > 0
  const showDedupeNote = enabled && times.length > 0 && events.length > 0

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" data-testid="agent-config-panel">
      {status && (
        <div
          role="status"
          className={`text-sm rounded-lg px-3 py-2 border ${
            status.kind === 'ok'
              ? 'text-green-400 bg-green-400/10 border-green-400/20'
              : 'text-red-400 bg-red-400/10 border-red-400/20'
          }`}
        >
          {status.text}
        </div>
      )}

      {/* Schedule */}
      <section className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[#eef3fb]">
              {continuous ? 'האזנה אוטומטית' : 'הרצה לפי שעה'}
            </h3>
            <p className="text-[11px] text-[#5a688c] mt-0.5">
              {continuous
                ? 'הסוכן בודק באופן רציף (כל כמה דקות) אם יש רשומה חדשה ופועל מיד — ללא שעה קבועה.'
                : 'הסוכן ירוץ אוטומטית בשעות שתגדיר, כל יום.'}
            </p>
            {agentId === CALENDAR_OPTIMIZER_AGENT_ID && (
              <p className="text-[11px] text-[#7a89ab] mt-1">
                בחר ״מחר״ כדי לקבל בערב את התוכנית ליום שאחרי ולהספיק לשנות.
              </p>
            )}
          </div>
          <Toggle
            checked={enabled}
            // Turning off must always be possible; turning on needs a time (unless it polls).
            disabled={saving || (!enabled && !canEnable)}
            label={continuous ? 'האזנה אוטומטית' : 'הרצה לפי שעה'}
            onChange={setEnabled}
          />
        </div>

        {!continuous && (
        <div className="flex flex-wrap items-center gap-2">
          {times.map((t) => {
            const offset = agentId === CALENDAR_OPTIMIZER_AGENT_ID ? (dayOffsets[t] ?? 0) : undefined
            return (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#2dd4bf]/12 border border-[#2dd4bf]/30 px-2.5 py-1 text-xs text-[#cdd7ea]"
              >
                <span dir="ltr" className="font-mono">
                  {t}
                </span>
                {agentId === CALENDAR_OPTIMIZER_AGENT_ID && (
                  <>
                    {offset === 1 && (
                      <span className="text-[#2dd4bf] text-[10px]">· מחר</span>
                    )}
                    <button
                      type="button"
                      aria-label={`החלף ל${offset === 1 ? 'היום' : 'מחר'} עבור שעה ${t}`}
                      disabled={saving}
                      onClick={() =>
                        setDayOffsets((prev) => ({ ...prev, [t]: prev[t] === 1 ? 0 : 1 }))
                      }
                      className="text-[#5a688c] hover:text-[#2dd4bf] transition-colors leading-none text-[10px] border border-[#3a507d] rounded px-1"
                    >
                      {offset === 1 ? 'היום' : 'מחר'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label={`הסר את השעה ${t}`}
                  disabled={saving}
                  onClick={() => {
                    const next = times.filter((x) => x !== t)
                    setTimes(next)
                    if (next.length === 0) setEnabled(false)
                    if (agentId === CALENDAR_OPTIMIZER_AGENT_ID) {
                      setDayOffsets((prev) => {
                        const copy = { ...prev }
                        delete copy[t]
                        return copy
                      })
                    }
                  }}
                  className="text-[#5a688c] hover:text-red-400 transition-colors leading-none"
                >
                  ×
                </button>
              </span>
            )
          })}

          <input
            type="time"
            dir="ltr"
            className="input text-xs py-1 px-2 w-[110px]"
            value={newTime}
            disabled={saving}
            aria-label="שעה להוספה"
            onChange={(e) => {
              setNewTime(e.target.value)
              setTimeError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTime(newTime)
              }
            }}
          />
          {agentId === CALENDAR_OPTIMIZER_AGENT_ID && (
            <div className="inline-flex rounded-md border border-[#3a507d] overflow-hidden text-xs" role="group" aria-label="יום הרצה">
              {([0, 1] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={saving}
                  onClick={() => setNewTimeOffset(v)}
                  aria-pressed={newTimeOffset === v}
                  className="px-2.5 py-1 transition-colors"
                  style={{
                    background: newTimeOffset === v ? '#2dd4bf22' : 'transparent',
                    borderColor: newTimeOffset === v ? '#2dd4bf' : 'transparent',
                    color: newTimeOffset === v ? '#2dd4bf' : '#97a4c2',
                    borderWidth: newTimeOffset === v ? '1px' : '0',
                  }}
                >
                  {v === 0 ? 'היום' : 'מחר'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 px-3 border border-[#3a507d]"
            disabled={saving || !newTime}
            onClick={() => addTime(newTime)}
          >
            הוסף שעה
          </button>
        </div>
        )}

        {timeError && <p className="text-[11px] text-red-400">{timeError}</p>}

        {!continuous && times.length === 0 && (
          <p className="text-[11px] text-[#5a688c]">
            אין שעות מוגדרות — הוסף שעה כדי לאפשר הרצה אוטומטית.
            {config.suggestedScheduleTimes.length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-[#2dd4bf] hover:underline"
                  disabled={saving}
                  onClick={() => setTimes(sortTimes(config.suggestedScheduleTimes))}
                >
                  השתמש במוצע ({config.suggestedScheduleTimes.join(', ')})
                </button>
              </>
            )}
          </p>
        )}
      </section>

      {/* Event triggers */}
      <section className="card p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-[#eef3fb]">הרצה לפי אירוע</h3>
          <p className="text-[11px] text-[#5a688c] mt-0.5">
            הסוכן ייקח על עצמו את ההתראות שתסמן, במקום התבנית המובנית של המערכת.
          </p>
        </div>

        <div className="flex flex-col divide-y divide-[#1d2b46]">
          {eventCatalog.map((event) => {
            const checked = events.includes(event.typeId)
            const owner = event.routedAgentId
            const takenByOther = !!owner && owner !== agentId
            return (
              <label
                key={event.typeId}
                className="flex items-start gap-3 py-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[#2dd4bf] cursor-pointer"
                  checked={checked}
                  disabled={saving}
                  onChange={(e) =>
                    setEvents(
                      e.target.checked
                        ? [...events, event.typeId].sort()
                        : events.filter((x) => x !== event.typeId),
                    )
                  }
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-[#cdd7ea]">{event.label}</span>
                  <span className="block text-[11px] text-[#647399] mt-0.5">
                    {event.description}
                    {event.schedulable && event.scheduleTimes.length > 0 && (
                      <>
                        {' · '}
                        <span dir="ltr" className="font-mono">
                          {event.scheduleTimes.join(', ')}
                        </span>
                      </>
                    )}
                  </span>
                  {takenByOther && !checked && (
                    <span className="block text-[11px] text-[#e0a33e] mt-0.5">
                      מטופל כרגע על ידי {agentNameById.get(owner) ?? owner} — סימון יעביר אליך
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        {showDedupeNote && (
          <p className="text-[11px] text-[#647399] border-t border-[#1d2b46] pt-2.5">
            הסוכן מוגדר גם לפי שעה וגם לפי אירוע — אם שניהם נופלים באותו חלון זמן, הוא ירוץ פעם אחת.
          </p>
        )}
      </section>

      {/* Trigger message */}
      <section className="card p-4 space-y-2">
        <div>
          <h3 className="text-sm font-medium text-[#eef3fb]">הוראות להרצה</h3>
          <p className="text-[11px] text-[#5a688c] mt-0.5">
            מה לבקש מהסוכן בכל הרצה. השאר ריק כדי להשתמש בברירת המחדל.
          </p>
        </div>
        <textarea
          className="input w-full text-sm min-h-[72px] resize-y"
          value={triggerMessage}
          disabled={saving}
          maxLength={4000}
          placeholder={config.defaultTriggerMessage}
          onChange={(e) => setTriggerMessage(e.target.value)}
        />
      </section>

      {/* Actions + last run */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary text-sm"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'שומר...' : 'שמור הגדרות'}
        </button>
        <button
          type="button"
          className="btn btn-ghost text-sm border border-[#3a507d]"
          disabled={run.isPending || saving}
          onClick={() => {
            setStatus(null)
            run.mutate({ agentId })
          }}
        >
          {run.isPending ? 'מריץ...' : 'הרץ עכשיו'}
        </button>
        {dirty && <span className="text-xs text-[#2dd4bf]">שינויים שלא נשמרו</span>}
      </div>

      <div className="text-[11px] text-[#5a688c]">
        ריצה אחרונה: {formatLastRun(config.lastRunAt)}
        {config.lastRunStatus === 'ok' && <span className="text-green-500/80"> · הצליחה</span>}
        {config.lastRunStatus === 'error' && (
          <span className="text-red-400"> · נכשלה: {config.lastRunError}</span>
        )}
      </div>
    </div>
  )
}
