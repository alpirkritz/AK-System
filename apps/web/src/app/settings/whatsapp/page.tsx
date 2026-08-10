'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type Tab = 'groups' | 'insights' | 'labels' | 'connection'

type DigestWindow = '6h' | '24h' | 'today' | 'yesterday' | '7d'
type InsightWindow = 'today' | 'yesterday' | '24h' | '7d' | '30d'

const PRIORITY_LABELS = ['רגיל', 'חשוב', 'קריטי']

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
        background: checked ? '#25D366' : '#2f4368',
        border: `1px solid ${checked ? '#25D36666' : '#3a507d'}`,
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
  priority: number
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

  const [digestWindow, setDigestWindow] = useState<DigestWindow>('24h')
  const [digestResult, setDigestResult] = useState<{
    text: string
    items: { groupJid: string; name: string; priority: number; messageCount: number; topic: string | null }[]
  } | null>(null)
  const [insightGroupJid, setInsightGroupJid] = useState<string>('')
  const [insightWindow, setInsightWindow] = useState<InsightWindow>('7d')
  const [groupInsight, setGroupInsight] = useState<{
    text: string
    mode: string
    messageCount: number
  } | null>(null)

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
  const { data: syncStatus, refetch: refetchSyncStatus } = trpc.whatsapp.sync.status.useQuery(undefined, {
    enabled: tab === 'connection',
    refetchInterval: tab === 'connection' ? 15000 : false,
    retry: false,
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
    onSuccess: (res) => {
      setMessage(`סונכרן ל-bridge — ${res.count} קבוצות פעילות`)
      void utils.whatsapp.sync.status.invalidate()
    },
    onError: (e) => setMessage(`שגיאת סנכרון: ${e.message}`),
  })

  const { data: messageStats = [] } = trpc.whatsapp.messages.stats.useQuery(undefined, {
    enabled: tab === 'insights',
  })

  const digestMut = trpc.whatsapp.insights.digest.useMutation({
    onSuccess: (res) => setDigestResult({ text: res.text, items: res.items }),
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  const forGroupMut = trpc.whatsapp.insights.forGroup.useMutation({
    onSuccess: (res) => setGroupInsight({ text: res.text, mode: res.mode, messageCount: res.messageCount }),
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
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
      priority: g.priority ?? 0,
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
          priority: 0,
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
      priority: d.priority,
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
    { id: 'insights', label: 'תובנות' },
    { id: 'labels', label: 'תוויות' },
    { id: 'connection', label: 'חיבור' },
  ]

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <h1 className="text-xl font-bold mt-2">WhatsApp</h1>
        <p className="text-xs text-[#5a688c] mt-1">
          ניהול קבוצות, התראות FOMO, מילות מפתח וסיכומים — כל ההתראות רק ל-Message Yourself
        </p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-[#1d2b46] pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="text-sm px-4 py-2 rounded-lg transition-all cursor-pointer"
            style={{
              background: tab === t.id ? '#25D36622' : 'transparent',
              color: tab === t.id ? '#25D366' : '#647399',
              border: `1px solid ${tab === t.id ? '#25D36644' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="mb-4 text-xs px-4 py-2 rounded-lg bg-[#1d2b46] border border-[#29395d] text-[#97a4c2]">
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
              className="flex-1 min-w-[140px] text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#97a4c2]"
            />
          </div>

          {groupsLoading || discovering ? (
            <div className="text-xs text-[#4d659c]">טוען קבוצות…</div>
          ) : filteredRows.length === 0 ? (
            <div className="card p-6 text-center text-sm text-[#5a688c]">
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
                      <div className="text-sm text-[#cdd7ea]">{d.name}</div>
                      <div className="text-[10px] text-[#5a688c]">
                        הודעה אחרונה: {fmtLastMessage(d.lastMessageAt)}
                      </div>
                      <div className="text-[10px] text-[#4d659c] font-mono">{d.jid}</div>
                      {isNew && (
                        <span className="text-[10px] text-[#25D366]">חדש — לא נשמר</span>
                      )}
                    </div>
                    <select
                      value={d.labelId ?? ''}
                      onChange={(e) => patchDraft(row.jid, { labelId: e.target.value || null })}
                      className="text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-2 py-1.5 text-[#97a4c2]"
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
                      <span className="text-[9px] text-[#5a688c] whitespace-nowrap">מעקב+FOMO</span>
                    </div>
                    <button
                      onClick={() => patchDraft(row.jid, { expanded: !expanded })}
                      className="text-[11px] text-[#647399] hover:text-[#97a4c2] px-2"
                    >
                      {expanded ? '▲' : '▼'} כללים
                    </button>
                  </div>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-[#1d2b46] pt-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-[#7a89ab] w-24">FOMO</span>
                        <span className="text-[11px] text-[#647399]">
                          {d.enabled ? 'פעיל (מקושר למעקב)' : 'כבוי — הפעל מעקב למעלה'}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={d.fomoThreshold}
                          onChange={(e) => patchDraft(row.jid, { fomoThreshold: Number(e.target.value) })}
                          className="w-14 text-[12px] bg-[#111b30] border border-[#29395d] rounded px-2 py-1 text-[#97a4c2]"
                          title="סף הודעות"
                        />
                        <span className="text-[10px] text-[#5a688c]">הודעות ב-</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={d.fomoWindowMinutes}
                          onChange={(e) => patchDraft(row.jid, { fomoWindowMinutes: Number(e.target.value) })}
                          className="w-14 text-[12px] bg-[#111b30] border border-[#29395d] rounded px-2 py-1 text-[#97a4c2]"
                          title="חלון דקות"
                        />
                        <span className="text-[10px] text-[#5a688c]">דקות</span>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-[#7a89ab] w-24">עדיפות בתובנות</span>
                        <select
                          value={d.priority}
                          onChange={(e) => patchDraft(row.jid, { priority: Number(e.target.value) })}
                          className="text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-2 py-1.5 text-[#97a4c2]"
                        >
                          {PRIORITY_LABELS.map((label, i) => (
                            <option key={i} value={i}>{label}</option>
                          ))}
                        </select>
                        <span className="text-[10px] text-[#5a688c]">קובע מי מודגש ב"מה קורה עכשיו"</span>
                      </div>

                      <div>
                        <label className="text-xs text-[#7a89ab] block mb-1">מילות מפתח (מופרדות בפסיק)</label>
                        <input
                          value={d.keywords}
                          onChange={(e) => patchDraft(row.jid, { keywords: e.target.value })}
                          placeholder="דחוף, deadline"
                          className="w-full text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#97a4c2]"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-[#7a89ab] block mb-1">
                          שעות סיכום (HH:MM, מופרדות בפסיק — דורס תווית)
                        </label>
                        <input
                          value={d.summaryTimes}
                          onChange={(e) => patchDraft(row.jid, { summaryTimes: e.target.value })}
                          placeholder="08:00, 20:00"
                          className="w-full text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#97a4c2]"
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

      {tab === 'insights' && (
        <div className="space-y-6">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm text-[#b8c4dc]">מה קורה עכשיו בקבוצות</div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="טווח זמן לתדריך"
                  value={digestWindow}
                  onChange={(e) => setDigestWindow(e.target.value as DigestWindow)}
                  className="text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-2 py-1.5 text-[#97a4c2]"
                >
                  <option value="6h">6 שעות</option>
                  <option value="24h">24 שעות</option>
                  <option value="today">היום</option>
                  <option value="yesterday">אתמול</option>
                  <option value="7d">7 ימים</option>
                </select>
                <button
                  onClick={() => digestMut.mutate({ window: digestWindow })}
                  disabled={digestMut.isPending}
                  className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-50"
                >
                  {digestMut.isPending ? 'מנתח…' : 'רענן תובנות'}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-[#5a688c]">
              תדריך מתועדף על פני כל הקבוצות במעקב — לפי חשיבות, נפח פעילות ומילות מפתח.
            </p>

            {digestMut.isPending ? (
              <div className="text-xs text-[#4d659c]">אוסף ומנתח הודעות…</div>
            ) : digestResult ? (
              <div className="space-y-3">
                {digestResult.items.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {digestResult.items.map((item) => (
                      <div
                        key={item.groupJid}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#111b30] border border-[#1d2b46]"
                      >
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                          style={{
                            background: item.priority >= 2 ? '#e74c3c22' : item.priority === 1 ? '#25D36622' : '#2f436833',
                            color: item.priority >= 2 ? '#f0a6a0' : item.priority === 1 ? '#25D366' : '#7a89ab',
                          }}
                        >
                          {PRIORITY_LABELS[item.priority] ?? 'רגיל'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-[#cdd7ea]">{item.name}</div>
                          {item.topic && <div className="text-[11px] text-[#8b98ba]">{item.topic}</div>}
                        </div>
                        <span className="text-[10px] text-[#4d659c] shrink-0 mt-0.5">{item.messageCount} הודעות</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[13px] text-[#b8c4dc] whitespace-pre-wrap leading-relaxed">
                  {digestResult.text}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#5a688c]">לחץ "רענן תובנות" כדי לקבל תדריך על כל הקבוצות.</div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="text-sm text-[#b8c4dc]">תובנות על קבוצה מסוימת</div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={insightGroupJid}
                onChange={(e) => {
                  setInsightGroupJid(e.target.value)
                  setGroupInsight(null)
                }}
                className="flex-1 min-w-[160px] text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-2 py-1.5 text-[#97a4c2]"
              >
                <option value="">בחר קבוצה…</option>
                {groups
                  .filter((g) => g.enabled)
                  .map((g) => (
                    <option key={g.jid} value={g.jid}>{g.name}</option>
                  ))}
              </select>
              <select
                aria-label="טווח זמן לתובנות הקבוצה"
                value={insightWindow}
                onChange={(e) => {
                  setInsightWindow(e.target.value as InsightWindow)
                  setGroupInsight(null)
                }}
                className="text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-2 py-1.5 text-[#97a4c2]"
              >
                <option value="today">היום</option>
                <option value="yesterday">אתמול</option>
                <option value="24h">24 שעות</option>
                <option value="7d">7 ימים</option>
                <option value="30d">30 יום</option>
              </select>
            </div>

            {insightGroupJid && (() => {
              const stat = messageStats.find((s) => s.groupJid === insightGroupJid)
              return (
                <div className="text-[11px] text-[#5a688c]">
                  {stat
                    ? `${stat.count} הודעות שמורות · מ-${fmtLastMessage(stat.earliestTs)} עד ${fmtLastMessage(stat.latestTs)}`
                    : 'אין הודעות שמורות עדיין — התובנות ימתינו לצבירת היסטוריה.'}
                </div>
              )
            })()}

            <div className="flex gap-2 flex-wrap">
              {(['summary', 'topics', 'style'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    if (!insightGroupJid) {
                      setMessage('בחר קבוצה קודם')
                      return
                    }
                    setGroupInsight(null)
                    forGroupMut.mutate({ groupJid: insightGroupJid, window: insightWindow, mode })
                  }}
                  disabled={forGroupMut.isPending || !insightGroupJid}
                  className="btn btn-ghost text-[12px] py-2 px-4 disabled:opacity-50"
                >
                  {mode === 'summary' ? 'סיכום' : mode === 'topics' ? 'על מה מדברים' : 'תובנות בסגנון שלי'}
                </button>
              ))}
            </div>

            {forGroupMut.isPending ? (
              <div className="text-xs text-[#4d659c]">מנתח את הקבוצה…</div>
            ) : groupInsight ? (
              <div className="border-t border-[#1d2b46] pt-3 space-y-2">
                <div className="text-[11px] text-[#5a688c]">
                  {`${groupInsight.messageCount} הודעות בטווח שנבחר`}
                </div>
                <div className="text-[13px] text-[#b8c4dc] whitespace-pre-wrap leading-relaxed">
                  {groupInsight.text}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {tab === 'labels' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-sm text-[#b8c4dc]">תווית חדשה / עריכה</div>
            <input
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="שם תווית (למשל: עבודה, משפחה)"
              className="w-full text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#97a4c2]"
            />
            <input
              value={newLabelTimes}
              onChange={(e) => setNewLabelTimes(e.target.value)}
              placeholder="שעות סיכום ברירת מחדל: 20:00"
              className="w-full text-[12px] bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#97a4c2]"
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
            <div className="text-xs text-[#4d659c]">טוען…</div>
          ) : labels.length === 0 ? (
            <div className="text-sm text-[#5a688c]">אין תוויות עדיין.</div>
          ) : (
            labels.map((label) => (
              <div key={label.id} className="card px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-[#cdd7ea]">{label.name}</div>
                  <div className="text-[10px] text-[#5a688c]">
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
            <div className="text-sm text-[#7a89ab]">
              ה-bridge לא מוגדר. הגדר <code className="text-[#647399]">WHATSAPP_BRIDGE_URL</code> ו-
              <code className="text-[#647399]">WHATSAPP_BRIDGE_SECRET</code> ב-.env.local
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: connection.connected ? '#25D366' : '#e74c3c' }}
                />
                <span className="text-sm text-[#b8c4dc]">
                  {connection.connected ? 'מחובר ל-WhatsApp' : 'לא מחובר'}
                </span>
              </div>
              {connection.selfJid && (
                <div className="text-[11px] text-[#5a688c] font-mono">Self JID: {connection.selfJid}</div>
              )}
              {'akWebhookConfigured' in connection && (
                <div className="text-sm text-[#97a4c2]">
                  Webhook ל-AK:{' '}
                  {connection.akWebhookConfigured ? (
                    <span className="text-[#34d399]">
                      מוגדר ({connection.akWebhookHost || '—'})
                      {!connection.replyEnabled && (
                        <span className="text-[#2dd4bf]"> — REPLY_ENABLED כבוי ב-bridge</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-red-400">
                      לא מוגדר — עדכן AK_WEBHOOK_URL ב-deploy/whatsapp-bridge.env ופרוס מחדש
                    </span>
                  )}
                </div>
              )}
              {syncStatus && (
                <div className="text-sm text-[#97a4c2]">
                  סנכרון קבוצות:{' '}
                  {syncStatus.inSync ? (
                    <span className="text-[#34d399]">
                      {syncStatus.bridgeWatchedCount} מסונכרנות בברידג׳ = {syncStatus.dbEnabledCount} פעילות ב-DB
                    </span>
                  ) : (
                    <span className="text-[#2dd4bf]">
                      {syncStatus.bridgeWatchedCount} בברידג׳ / {syncStatus.dbEnabledCount} פעילות ב-DB — לחץ "סנכרן כללים ל-bridge"
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
                  void refetchSyncStatus()
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
