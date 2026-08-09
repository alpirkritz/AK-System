'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type Channel = 'whatsapp' | 'push' | 'telegram'

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  push: 'פוש',
  telegram: 'Telegram',
}

const CATEGORY_TITLES: Record<string, string> = {
  cron: 'תדריכי מערכת',
  agent: 'סוכנים',
  whatsapp: 'WhatsApp והוגו',
  hugo: 'WhatsApp והוגו',
}

const CATEGORY_ORDER = ['cron', 'agent', 'whatsapp'] as const

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
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
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

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px]"
      style={{
        background: ok ? '#34d39918' : '#1d2b46',
        border: `1px solid ${ok ? '#34d39944' : '#2f4368'}`,
        color: ok ? '#34d399' : '#647399',
      }}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: ok ? '#34d399' : '#5a688c' }}
      />
      {label} — {ok ? 'מחובר' : 'לא מחובר'}
    </div>
  )
}

export default function NotificationSettingsPage() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.settings.notifications.list.useQuery()
  const { data: triggers } = trpc.agents.list.useQuery()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({})
  const [triggerDrafts, setTriggerDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission)
  }, [])

  const upsert = trpc.settings.notifications.upsert.useMutation({
    onSuccess: () => utils.settings.notifications.list.invalidate(),
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
    onSettled: () => setSavingId(null),
  })

  const reset = trpc.settings.notifications.resetDefaults.useMutation({
    onSuccess: () => {
      utils.settings.notifications.list.invalidate()
      setMessage('שוחזרו ברירות המחדל')
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  const channels = data?.channels
  const items = data?.items ?? []
  const agents = data?.agents ?? []
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]))
  const scheduleByAgent = new Map(
    (triggers?.agents ?? []).map((a) => [a.agentId, a]),
  )

  function channelConnected(ch: Channel): boolean {
    if (!channels) return true
    return ch === 'whatsapp' ? channels.whatsapp : ch === 'telegram' ? channels.telegram : channels.push
  }

  function saveEnabled(typeId: string, enabled: boolean) {
    setSavingId(typeId)
    setMessage(null)
    upsert.mutate({ typeId, enabled })
  }

  function saveChannel(typeId: string, ch: Channel, value: boolean) {
    setSavingId(typeId)
    setMessage(null)
    upsert.mutate({ typeId, channels: { [ch]: value } })
  }

  function saveTimes(typeId: string, raw: string) {
    const times = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{2}:\d{2}$/.test(s))
    setSavingId(typeId)
    setMessage(null)
    upsert.mutate({ typeId, scheduleTimes: times })
  }

  function saveAgent(typeId: string, agentId: string) {
    setSavingId(typeId)
    setMessage(null)
    upsert.mutate({ typeId, agentId: agentId || null })
  }

  function saveTrigger(typeId: string, raw: string) {
    setSavingId(typeId)
    setMessage(null)
    upsert.mutate({ typeId, triggerMessage: raw.trim() || null })
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    title: CATEGORY_TITLES[cat],
    rows: items.filter((i) => (cat === 'whatsapp' ? i.category === 'whatsapp' || i.category === 'hugo' : i.category === cat)),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="max-w-3xl mx-auto pb-16" data-testid="notification-prefs">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <h1 className="text-xl font-bold mt-2">התראות וערוצים</h1>
        <p className="text-xs text-[#5a688c] mt-1">
          כל סוגי ההתראות במקום אחד — הפעלה או כיבוי לכל ערוץ, ושעות לתדריכים היומיים.
        </p>
      </div>

      {message && (
        <div className="card p-3 mb-4 text-[13px] text-[#2dd4bf]" role="status">
          {message}
        </div>
      )}

      {/* Channel status */}
      <div className="mb-6">
        <div className="text-[11px] text-[#5a688c] uppercase tracking-wider mb-2">מצב ערוצים</div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label="WhatsApp" ok={!!channels?.whatsapp} />
          <StatusPill label="Telegram" ok={!!channels?.telegram} />
          <StatusPill
            label="פוש PWA (מק/דפדפן)"
            ok={!!channels?.push && (channels?.webPushDevices ?? 0) > 0 && permission === 'granted'}
          />
          <StatusPill
            label="פוש ARO (טלפון)"
            ok={(channels?.fcmPushDevices ?? 0) > 0}
          />
        </div>
        {permission !== 'granted' && (
          <p className="text-[11px] text-[#5a688c] mt-2">
            כדי לקבל פוש PWA במכשיר הזה, הפעל נוטיפיקציות ב{' '}
            <Link href="/settings" className="text-[#2dd4bf] hover:underline">
              הגדרות
            </Link>
            .
          </p>
        )}
        {(channels?.webPushDevices ?? 0) === 0 && channels?.push && permission === 'granted' && (
          <p className="text-[11px] text-[#5a688c] mt-2">
            VAPID מוגדר בשרת אבל המכשיר הזה עדיין לא רשום — לחץ &quot;הפעל נוטיפיקציות&quot; בהגדרות.
          </p>
        )}
        {(channels?.fcmPushDevices ?? 0) === 0 && (
          <p className="text-[11px] text-[#5a688c] mt-2">
            אין מכשיר ARO רשום — פתח את אפליקציית ARO → הגדרות → הפעל התראות Push.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 h-20 animate-pulse opacity-40" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((group) => (
            <div key={group.cat}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-[#cdd7ea]">{group.title}</div>
                {group.cat === 'agent' && (
                  <Link
                    href="/agents/manage"
                    className="text-[12px] text-[#2dd4bf] hover:underline"
                  >
                    ערוך טריגרים של סוכנים ←
                  </Link>
                )}
                {group.cat === 'whatsapp' && (
                  <Link
                    href="/settings/whatsapp"
                    className="text-[12px] text-[#25D366] hover:underline"
                  >
                    נהל קבוצות ←
                  </Link>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {group.rows.map((item) => {
                  const saving = savingId === item.id
                  const timeValue =
                    timeDrafts[item.id] ?? item.scheduleTimes.join(', ')
                  return (
                    <div key={item.id} className="card p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] text-[#cdd7ea] flex items-center gap-2">
                            {item.label}
                            {saving && (
                              <span className="text-[10px] text-[#5a688c]">שומר…</span>
                            )}
                          </div>
                          <div className="text-[12px] text-[#647399] mt-0.5">
                            {item.description}
                          </div>
                        </div>
                        <Toggle
                          checked={item.enabled}
                          onChange={(v) => saveEnabled(item.id, v)}
                        />
                      </div>

                      {item.enabled && (
                        <div className="mt-3 pt-3 border-t border-[#1d2b46] flex flex-wrap items-center gap-x-5 gap-y-2">
                          {(['whatsapp', 'push', 'telegram'] as Channel[])
                            .filter((ch) => item.availableChannels.includes(ch))
                            .map((ch) => {
                              const connected = channelConnected(ch)
                              return (
                                <label
                                  key={ch}
                                  className="flex items-center gap-2 text-[12px] text-[#8593b3]"
                                  title={connected ? undefined : `${CHANNEL_LABELS[ch]} לא מחובר`}
                                >
                                  <Toggle
                                    checked={item.channels[ch] && connected}
                                    disabled={!connected}
                                    onChange={(v) => saveChannel(item.id, ch, v)}
                                  />
                                  {CHANNEL_LABELS[ch]}
                                </label>
                              )
                            })}

                          {item.schedulable && (
                            <div className="flex items-center gap-2 text-[12px] text-[#8593b3]">
                              <span>שעה</span>
                              <input
                                className="input text-[12px] py-1 px-2 w-24 text-center"
                                value={timeValue}
                                placeholder={item.defaultTime ?? '07:00'}
                                onChange={(e) =>
                                  setTimeDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                onBlur={(e) => {
                                  if (e.target.value !== item.scheduleTimes.join(', ')) {
                                    saveTimes(item.id, e.target.value)
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {item.enabled && item.routable && (
                        <div className="mt-3 pt-3 border-t border-[#1d2b46] flex flex-col gap-2">
                          <label className="flex items-center gap-2 text-[12px] text-[#8593b3]">
                            <span className="w-20 shrink-0">סוכן מטפל</span>
                            <select
                              className="input text-[12px] py-1 px-2 flex-1"
                              value={item.agentId ?? ''}
                              onChange={(e) => saveAgent(item.id, e.target.value)}
                            >
                              <option value="">
                                תבנית מערכת (ללא סוכן)
                                {item.suggestedAgentId
                                  ? ` — מומלץ: ${agentNameById.get(item.suggestedAgentId) ?? item.suggestedAgentId}`
                                  : ''}
                              </option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {item.agentId && (
                            <label className="flex items-start gap-2 text-[12px] text-[#8593b3]">
                              <span className="w-20 shrink-0 pt-1.5">הוראות</span>
                              <textarea
                                className="input text-[12px] py-1 px-2 flex-1 min-h-[52px]"
                                value={triggerDrafts[item.id] ?? item.triggerMessage ?? ''}
                                placeholder="מה לבקש מהסוכן (ריק = ברירת מחדל)"
                                onChange={(e) =>
                                  setTriggerDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                onBlur={(e) => {
                                  if (e.target.value.trim() !== (item.triggerMessage ?? '')) {
                                    saveTrigger(item.id, e.target.value)
                                  }
                                }}
                              />
                            </label>
                          )}
                        </div>
                      )}

                      {group.cat === 'agent' && (
                        <div className="mt-3 pt-3 border-t border-[#1d2b46]">
                          <div className="text-[11px] text-[#5a688c] mb-1.5">
                            סוכנים מתוזמנים ({(triggers?.agents ?? []).filter((a) => a.enabled).length} פעילים)
                          </div>
                          <div className="flex flex-col gap-1">
                            {(triggers?.agents ?? [])
                              .filter((a) => a.enabled || a.scheduleTimes.length > 0)
                              .map((a) => {
                                const cfg = scheduleByAgent.get(a.agentId)
                                return (
                                  <div
                                    key={a.agentId}
                                    className="flex items-center justify-between text-[12px]"
                                  >
                                    <span className="text-[#8593b3]">{a.name}</span>
                                    <span className="text-[#5a688c]">
                                      {cfg?.enabled
                                        ? (cfg.scheduleTimes.join(', ') || '—')
                                        : 'כבוי'}
                                    </span>
                                  </div>
                                )
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <DeliveryLogSection />

          <div>
            <button
              onClick={() => {
                if (window.confirm('לשחזר את כל ההתראות לברירת המחדל?')) reset.mutate()
              }}
              disabled={reset.isPending}
              className="btn btn-ghost text-[12px] py-1.5 px-3 disabled:opacity-40"
            >
              שחזר ברירות מחדל
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** FCM push delivery log — debugs "נשלח אבל לא הגיע לטלפון". */
function DeliveryLogSection() {
  const { data: log } = trpc.push.deliveryLog.useQuery(undefined, {
    refetchInterval: 60_000,
  })
  if (!log || log.length === 0) return null

  const statusLabel: Record<string, string> = {
    pending: '⏳ ממתין',
    ok: '✅ נמסר',
    error: '❌ נכשל',
    expired: '⌛ פג תוקף',
  }

  return (
    <div className="card p-4">
      <div className="text-[13px] font-medium mb-1">יומן מסירת פוש (FCM)</div>
      <div className="text-[11px] text-[#5a688c] mb-2">
        תוצאות מסירה ישירות מ-Firebase — כולל שגיאות credentials וטוקנים מתים
      </div>
      <div className="flex flex-col gap-1">
        {log.slice(0, 12).map((entry) => (
          <div key={entry.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-[#8593b3] truncate">
              {entry.provider ? `[${entry.provider}] ` : ''}
              {statusLabel[entry.status] ?? entry.status}
              {entry.errorCode ? ` — ${entry.errorCode}` : ''}
              {entry.message ? ` · ${entry.message}` : ''}
            </span>
            <span className="text-[#5a688c] shrink-0" dir="ltr">
              {new Date(entry.sentAt).toLocaleString('he-IL', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
