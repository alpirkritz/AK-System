'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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

function parseTimes(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{2}:\d{2}$/.test(s))
}

function formatLastRun(iso: string | null): string {
  if (!iso) return '—'
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

interface AgentTriggersPanelProps {
  agentId: string
  agentName: string
}

export function AgentTriggersPanel({ agentId, agentName }: AgentTriggersPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [timesRaw, setTimesRaw] = useState('')
  const [triggerMessage, setTriggerMessage] = useState('')
  const [dirty, setDirty] = useState(false)

  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.agents.triggers.list.useQuery()

  const config = data?.agents.find((a) => a.agentId === agentId)

  useEffect(() => {
    if (!config) return
    setEnabled(config.enabled)
    setTimesRaw(config.scheduleTimes.join(', '))
    setTriggerMessage(config.triggerMessage ?? '')
    setDirty(false)
  }, [config])

  const upsert = trpc.agents.triggers.upsert.useMutation({
    onSuccess: () => {
      utils.agents.triggers.list.invalidate()
      setMessage('נשמר')
      setDirty(false)
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  const run = trpc.agents.triggers.run.useMutation({
    onSuccess: (res) => {
      utils.agents.triggers.list.invalidate()
      if (res.ok) {
        setMessage('הסוכן סיים — התוצאה נשלחה להתראות')
      } else {
        setMessage(res.error ?? 'הרצה נכשלה')
      }
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  function handleSave() {
    const scheduleTimes = parseTimes(timesRaw)
    if (config?.schedulable && scheduleTimes.length === 0 && enabled) {
      setMessage('יש להגדיר לפחות שעה אחת (למשל 07:00)')
      return
    }
    upsert.mutate({
      agentId,
      enabled: config?.schedulable ? enabled : false,
      scheduleTimes: config?.schedulable ? scheduleTimes : undefined,
      triggerMessage: triggerMessage.trim() || null,
    })
  }

  if (isLoading) {
    return (
      <div className="text-xs text-[#555] px-1 py-2">טוען טריגרים...</div>
    )
  }

  if (!config) return null

  const running = run.isPending

  return (
    <div className="border border-[#1a1a1a] rounded-xl bg-[#0d0d0d] mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-[#aaa] hover:text-[#f0ede6] transition-colors"
      >
        <span>
          טריגרים
          <span className="text-[10px] text-[#555] mr-2">סוכן מלא AI</span>
        </span>
        <span className="text-[#555]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#1a1a1a] pt-3">
          <p className="text-[11px] text-[#555] leading-relaxed">
            הרצה אוטומטית של {agentName} לפי שעות (במקביל לדיג&apos;סטים הקלים של המערכת).
            דורש מנוע Gemini.
          </p>

          {config.schedulable ? (
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-[#aaa]">טריגר יומי פעיל</label>
              <Toggle
                checked={enabled}
                disabled={upsert.isPending}
                onChange={(v) => {
                  setEnabled(v)
                  setDirty(true)
                }}
              />
            </div>
          ) : (
            <p className="text-xs text-[#666]">סוכן זה מיועד להרצה ידנית בלבד (ללא לוח זמנים).</p>
          )}

          {config.schedulable && (
            <div>
              <label className="text-xs text-[#555] block mb-1">שעות (HH:MM, מופרד בפסיק)</label>
              <input
                type="text"
                className="input w-full text-sm"
                value={timesRaw}
                disabled={upsert.isPending}
                onChange={(e) => {
                  setTimesRaw(e.target.value)
                  setDirty(true)
                }}
                placeholder="07:00, 20:00"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-[#555] block mb-1">הודעת טריגר (אופציונלי)</label>
            <textarea
              className="input w-full text-sm min-h-[60px] resize-y"
              value={triggerMessage}
              disabled={upsert.isPending}
              placeholder={config.defaultTriggerMessage}
              onChange={(e) => {
                setTriggerMessage(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <button
                type="button"
                className="btn btn-primary text-sm"
                disabled={upsert.isPending}
                onClick={handleSave}
              >
                {upsert.isPending ? 'שומר...' : 'שמור'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost text-sm border border-[#333]"
              disabled={running || upsert.isPending}
              onClick={() => run.mutate({ agentId })}
            >
              {running ? 'מריץ...' : 'הרץ עכשיו'}
            </button>
          </div>

          <div className="text-[11px] text-[#555]">
            ריצה אחרונה: {formatLastRun(config.lastRunAt)}
            {config.lastRunStatus === 'ok' && (
              <span className="text-green-500/80 mr-1"> · הצליח</span>
            )}
            {config.lastRunStatus === 'error' && (
              <span className="text-red-400 mr-1"> · נכשל: {config.lastRunError}</span>
            )}
          </div>

          {message && (
            <p className="text-xs text-[#e8c547]">{message}</p>
          )}
        </div>
      )}
    </div>
  )
}
