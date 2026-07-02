'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type Tab = 'groups' | 'labels' | 'connection'

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
      className="relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: checked ? '#25D366' : '#2a2a2a',
        border: `1px solid ${checked ? '#25D36666' : '#333'}`,
      }}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform shadow"
        style={{ transform: `translateX(${checked ? '19px' : '3px'})` }}
      />
    </button>
  )
}

interface GroupDraft {
  id?: string
  jid: string
  name: string
  labelId: string | null
  enabled: boolean
  fomoEnabled: boolean
  fomoThreshold: number
  fomoWindowMinutes: number
  summaryTimes: string
  keywords: string
  lastMessageAt: number | null
  expanded?: boolean
}

function fmtLastMessage(ms: number | null): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function parseTimes(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{2}:\d{2}$/.test(s))
}

export default function WhatsAppSettingsPage() {
  const [tab, setTab] = useState<Tab>('groups')
  const [message, setMessage] = useState<string | null>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [togglingJid, setTogglingJid] = useState<string | null>(null)

  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelTimes, setNewLabelTimes] = useState('20:00')
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const { data: labels = [], isLoading: labelsLoading } = trpc.whatsapp.labels.list.useQuery()
  const { data: groups = [], isLoading: groupsLoading } = trpc.whatsapp.groups.list.useQuery()
  const {
    data: discovered = [],
    isLoading: discovering,
    refetch: refetchDiscover,
  } = trpc.whatsapp.groups.discover.useQuery(undefined, {
    enabled: tab === 'groups',
    retry: false,
  })
  const { data: connection, refetch: refetchConnection } = trpc.whatsapp.connection.status.useQuery(undefined, {
    enabled: tab === 'connection',
    refetchInterval: tab === 'connection' ? 10000 : false,
  })

  const upsertGroup = trpc.whatsapp.groups.upsert.useMutation({
    onSuccess: () => {
      utils.whatsapp.groups.list.invalidate()
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  const deleteGroup = trpc.whatsapp.groups.delete.useMutation({
    onSuccess: () => utils.whatsapp.groups.list.invalidate(),
  })

  const upsertLabel = trpc.whatsapp.labels.upsert.useMutation({
    onSuccess: () => {
      utils.whatsapp.labels.list.invalidate()
      setNewLabelName('')
      setEditingLabelId(null)
      setMessage('התווית נשמרה')
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  const deleteLabel = trpc.whatsapp.labels.delete.useMutation({
    onSuccess: () => utils.whatsapp.groups.list.invalidate(),
  })

  const syncBridge = trpc.whatsapp.sync.pushToBridge.useMutation({
    onSuccess: (res) => setMessage(`סונכרן ל-bridge — ${res.count} קבוצות פעילות`),
    onError: (e) => setMessage(`שגיאת סנכרון: ${e.message}`),
  })

  const mergedRows = useMemo(() => {
    const byJid = new Map(groups.map((g) => [g.jid, g]))
    const lastMsgByJid = new Map(discovered.map((d) => [d.jid, d.lastMessageAt ?? null]))
    const rows: GroupDraft[] = groups.map((g) => ({
      id: g.id,
      jid: g.jid,
      name: g.name,
      labelId: g.labelId,
      enabled: !!g.enabled,
      fomoEnabled: !!g.fomoEnabled,
      fomoThreshold: g.fomoThreshold,
      fomoWindowMinutes: g.fomoWindowMinutes,
      summaryTimes: (g.summaryTimes ?? []).join(', '),
      keywords: (g.keywords ?? []).join(', '),
      lastMessageAt: lastMsgByJid.get(g.jid) ?? null,
    }))
    for (const d of discovered) {
      if (!byJid.has(d.jid)) {
        rows.push({
          jid: d.jid,
          name: d.name,
          labelId: null,
          enabled: false,
          fomoEnabled: false,
          fomoThreshold: 5,
          fomoWindowMinutes: 5,
          summaryTimes: '',
          keywords: '',
          lastMessageAt: d.lastMessageAt ?? null,
        })
      } else {
        const row = rows.find((r) => r.jid === d.jid)
        if (row && d.lastMessageAt) row.lastMessageAt = d.lastMessageAt
      }
    }
    return rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
  }, [groups, discovered])

  const filteredRows = useMemo(() => {
    const q = nameFilter.trim().toLowerCase()
    if (!q) return mergedRows
    return mergedRows.filter((r) => r.name.toLowerCase().includes(q))
  }, [mergedRows, nameFilter])

  const [drafts, setDrafts] = useState<Record<string, GroupDraft>>({})

  function getDraft(row: GroupDraft): GroupDraft {
    return drafts[row.jid] ?? row
  }

  function patchDraft(jid: string, patch: Partial<GroupDraft>) {
    setDrafts((prev) => {
      const base = prev[jid] ?? mergedRows.find((r) => r.jid === jid)!
      return { ...prev, [jid]: { ...base, ...patch } }
    })
  }

  async function handleDiscover() {
    setMessage(null)
    try {
      const result = await refetchDiscover()
      const count = result.data?.length ?? 0
      setMessage(`נמצאו ${count} קבוצות ב-WhatsApp`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'שגיאה בגילוי קבוצות')
    }
  }

  async function saveGroup(row: GroupDraft) {
    const d = getDraft(row)
    const enabled = d.enabled
    await upsertGroup.mutateAsync({
      id: d.id,
      jid: d.jid,
      name: d.name,
      labelId: d.labelId,
      enabled,
      fomoEnabled: enabled ? true : d.fomoEnabled,
      fomoThreshold: d.fomoThreshold,
      fomoWindowMinutes: d.fomoWindowMinutes,
      summaryTimes: parseTimes(d.summaryTimes),
      keywords: d.keywords.split(/[,;]+/).map((k) => k.trim()).filter(Boolean),
    })
  }

  async function handleFollowToggle(row: GroupDraft, enabled: boolean) {
    setTogglingJid(row.jid)
    setMessage(null)
    patchDraft(row.jid, { enabled, fomoEnabled: enabled })
    try {
      const d = { ...getDraft(row), enabled, fomoEnabled: enabled }
      await saveGroup(d)
      await syncBridge.mutateAsync()
      setMessage(enabled ? `מעקב + FOMO הופעלו — ${d.name}` : `מעקב הופסק — ${d.name}`)
    } catch (e) {
      patchDraft(row.jid, { enabled: !enabled, fomoEnabled: !enabled })
      setMessage(e instanceof Error ? e.message : 'שגיאה בשמירה')
    } finally {
      setTogglingJid(null)
    }
  }

  async function handleSaveAndSync(row: GroupDraft) {
    await saveGroup(row)
    await syncBridge.mutateAsync()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'groups', label: 'קבוצות' },
    { id: 'labels', label: 'תוויות' },
    { id: 'connection', label: 'חיבור' },
  ]

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#555] hover:text-[#888]">
          ← חזרה להגדרות
        </Link>
        <h1 className="text-xl font-bold mt-2">WhatsApp</h1>
        <p className="text-xs text-[#555] mt-1">
          ניהול קבוצות, התראות FOMO, מילות מפתח וסיכומים — כל ההתראות רק ל-Message Yourself
        </p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-[#1a1a1a] pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="text-sm px-4 py-2 rounded-lg transition-all cursor-pointer"
            style={{
              background: tab === t.id ? '#25D36622' : 'transparent',
              color: tab === t.id ? '#25D366' : '#666',
              border: `1px solid ${tab === t.id ? '#25D36644' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="mb-4 text-xs px-4 py-2 rounded-lg bg-[#1a1a1a] border border-[#222] text-[#aaa]">
          {message}
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={() => void handleDiscover()}
              disabled={discovering}
              className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-50"
            >
              {discovering ? 'טוען…' : 'רענון מ-WhatsApp'}
            </button>
            <button
              onClick={() => syncBridge.mutate()}
              disabled={syncBridge.isPending}
              className="btn btn-ghost text-[12px] py-2 px-4 disabled:opacity-50"
            >
              {syncBridge.isPending ? 'מסנכרן…' : 'סנכרן כללים ל-bridge'}
            </button>
            <input
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="סינון לפי שם…"
              className="flex-1 min-w-[140px] text-[12px] bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-[#aaa]"
            />
          </div>

          {groupsLoading || discovering ? (
            <div className="text-xs text-[#444]">טוען קבוצות…</div>
          ) : filteredRows.length === 0 ? (
            <div className="card p-6 text-center text-sm text-[#555]">
              {mergedRows.length === 0
                ? 'אין קבוצות. לחץ "רענון מ-WhatsApp" כדי לגלות קבוצות.'
                : 'אין קבוצות התואמות לסינון.'}
            </div>
          ) : (
            filteredRows.map((row) => {
              const d = getDraft(row)
              const expanded = d.expanded ?? false
              const isNew = !row.id
              return (
                <div key={row.jid} className="card p-0 overflow-hidden">
                  <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[140px]">
                      <div className="text-sm text-[#ddd]">{d.name}</div>
                      <div className="text-[10px] text-[#555]">
                        הודעה אחרונה: {fmtLastMessage(d.lastMessageAt)}
                      </div>
                      <div className="text-[10px] text-[#444] font-mono">{d.jid}</div>
                      {isNew && (
                        <span className="text-[10px] text-[#25D366]">חדש — לא נשמר</span>
                      )}
                    </div>
                    <select
                      value={d.labelId ?? ''}
                      onChange={(e) => patchDraft(row.jid, { labelId: e.target.value || null })}
                      className="text-[12px] bg-[#111] border border-[#222] rounded-lg px-2 py-1.5 text-[#aaa]"
                    >
                      <option value="">ללא תווית</option>
                      {labels.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <div className="flex flex-col items-center gap-0.5">
                      <Toggle
                        checked={d.enabled}
                        disabled={togglingJid === row.jid}
                        onChange={(v) => void handleFollowToggle(row, v)}
                      />
                      <span className="text-[9px] text-[#555] whitespace-nowrap">מעקב+FOMO</span>
                    </div>
                    <button
                      onClick={() => patchDraft(row.jid, { expanded: !expanded })}
                      className="text-[11px] text-[#666] hover:text-[#aaa] px-2"
                    >
                      {expanded ? '▲' : '▼'} כללים
                    </button>
                  </div>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-[#1a1a1a] pt-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-[#888] w-24">FOMO</span>
                        <span className="text-[11px] text-[#666]">
                          {d.enabled ? 'פעיל (מקושר למעקב)' : 'כבוי — הפעל מעקב למעלה'}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={d.fomoThreshold}
                          onChange={(e) => patchDraft(row.jid, { fomoThreshold: Number(e.target.value) })}
                          className="w-14 text-[12px] bg-[#111] border border-[#222] rounded px-2 py-1 text-[#aaa]"
                          title="סף הודעות"
                        />
                        <span className="text-[10px] text-[#555]">הודעות ב-</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={d.fomoWindowMinutes}
                          onChange={(e) => patchDraft(row.jid, { fomoWindowMinutes: Number(e.target.value) })}
                          className="w-14 text-[12px] bg-[#111] border border-[#222] rounded px-2 py-1 text-[#aaa]"
                          title="חלון דקות"
                        />
                        <span className="text-[10px] text-[#555]">דקות</span>
                      </div>

                      <div>
                        <label className="text-xs text-[#888] block mb-1">מילות מפתח (מופרדות בפסיק)</label>
                        <input
                          value={d.keywords}
                          onChange={(e) => patchDraft(row.jid, { keywords: e.target.value })}
                          placeholder="דחוף, deadline"
                          className="w-full text-[12px] bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-[#aaa]"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-[#888] block mb-1">
                          שעות סיכום (HH:MM, מופרדות בפסיק — דורס תווית)
                        </label>
                        <input
                          value={d.summaryTimes}
                          onChange={(e) => patchDraft(row.jid, { summaryTimes: e.target.value })}
                          placeholder="08:00, 20:00"
                          className="w-full text-[12px] bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-[#aaa]"
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => void handleSaveAndSync(row)}
                          disabled={upsertGroup.isPending}
                          className="btn btn-primary text-[11px] py-1.5 px-3"
                        >
                          שמור וסנכרן
                        </button>
                        {row.id && (
                          <button
                            onClick={() => {
                              if (confirm('למחוק את הקבוצה מההגדרות?')) {
                                deleteGroup.mutate({ id: row.id! })
                              }
                            }}
                            className="btn btn-ghost text-[11px] py-1.5 px-3 text-red-400"
                          >
                            מחק
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'labels' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-sm text-[#ccc]">תווית חדשה / עריכה</div>
            <input
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="שם תווית (למשל: עבודה, משפחה)"
              className="w-full text-[12px] bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-[#aaa]"
            />
            <input
              value={newLabelTimes}
              onChange={(e) => setNewLabelTimes(e.target.value)}
              placeholder="שעות סיכום ברירת מחדל: 20:00"
              className="w-full text-[12px] bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-[#aaa]"
            />
            <button
              onClick={() => {
                if (!newLabelName.trim()) return
                upsertLabel.mutate({
                  id: editingLabelId ?? undefined,
                  name: newLabelName.trim(),
                  summaryTimes: parseTimes(newLabelTimes),
                })
              }}
              disabled={!newLabelName.trim() || upsertLabel.isPending}
              className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-50"
            >
              {editingLabelId ? 'עדכן תווית' : 'הוסף תווית'}
            </button>
          </div>

          {labelsLoading ? (
            <div className="text-xs text-[#444]">טוען…</div>
          ) : labels.length === 0 ? (
            <div className="text-sm text-[#555]">אין תוויות עדיין.</div>
          ) : (
            labels.map((label) => (
              <div key={label.id} className="card px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-[#ddd]">{label.name}</div>
                  <div className="text-[10px] text-[#555]">
                    סיכום: {(label.summaryTimes ?? []).join(', ') || '—'} · {label.groupCount} קבוצות
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingLabelId(label.id)
                      setNewLabelName(label.name)
                      setNewLabelTimes((label.summaryTimes ?? []).join(', '))
                    }}
                    className="btn btn-ghost text-[11px] py-1 px-2"
                  >
                    ערוך
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`למחוק את "${label.name}"?`)) deleteLabel.mutate({ id: label.id })
                    }}
                    className="btn btn-ghost text-[11px] py-1 px-2 text-red-400"
                  >
                    מחק
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'connection' && (
        <div className="card p-5 space-y-4">
          {!connection?.configured ? (
            <div className="text-sm text-[#888]">
              ה-bridge לא מוגדר. הגדר <code className="text-[#666]">WHATSAPP_BRIDGE_URL</code> ו-
              <code className="text-[#666]">WHATSAPP_BRIDGE_SECRET</code> ב-.env.local
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: connection.connected ? '#25D366' : '#e74c3c' }}
                />
                <span className="text-sm text-[#ccc]">
                  {connection.connected ? 'מחובר ל-WhatsApp' : 'לא מחובר'}
                </span>
              </div>
              {connection.selfJid && (
                <div className="text-[11px] text-[#555] font-mono">Self JID: {connection.selfJid}</div>
              )}
              {'akWebhookConfigured' in connection && (
                <div className="text-sm text-[#aaa]">
                  Webhook ל-AK:{' '}
                  {connection.akWebhookConfigured ? (
                    <span className="text-[#47b86e]">
                      מוגדר ({connection.akWebhookHost || '—'})
                      {!connection.replyEnabled && (
                        <span className="text-[#e8c547]"> — REPLY_ENABLED כבוי ב-bridge</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-red-400">
                      לא מוגדר — עדכן AK_WEBHOOK_URL ב-deploy/whatsapp-bridge.env ופרוס מחדש
                    </span>
                  )}
                </div>
              )}
              {connection.lastError && (
                <div className="text-xs text-red-400">{connection.lastError}</div>
              )}
              {'bridgeUrl' in connection && connection.bridgeUrl && (
                <a
                  href={connection.bridgeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[12px] text-[#25D366] hover:underline"
                >
                  פתח דף QR / pairing ב-bridge →
                </a>
              )}
              <button
                onClick={() => {
                  void refetchConnection()
                  setMessage('סטטוס עודכן')
                }}
                className="btn btn-ghost text-[12px] py-2 px-4"
              >
                רענן סטטוס
              </button>
              <button
                onClick={() => syncBridge.mutate()}
                disabled={syncBridge.isPending}
                className="btn btn-primary text-[12px] py-2 px-4 ml-2 disabled:opacity-50"
              >
                סנכרן כללים ל-bridge
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
