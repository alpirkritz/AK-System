'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { SlackPeoplePanel } from './SlackPeoplePanel'

const NO_CHANNELS: never[] = []

type Tab = 'connection' | 'channels' | 'people'

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
        background: checked ? '#4A154B' : '#2f4368',
        border: `1px solid ${checked ? '#7c3aed66' : '#3a507d'}`,
      }}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform shadow"
        style={{ transform: `translateX(${checked ? '19px' : '3px'})` }}
      />
    </button>
  )
}

interface ChannelDraft {
  channelId: string
  name: string
  isPrivate: boolean | number
  enabled: boolean | number
  fomoEnabled: boolean | number
  fomoThreshold: number
  fomoWindowMinutes: number
  keywords: string
  kind?: string
  expanded?: boolean
}

const KIND_SECTIONS: { kind: string; label: string }[] = [
  { kind: 'dm', label: 'הודעות פרטיות' },
  { kind: 'group_dm', label: 'קבוצות פרטיות' },
  { kind: 'channel', label: 'ערוצים' },
]

export default function SlackSettingsPage() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>('connection')
  const [message, setMessage] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelDraft[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const { data: connection, isLoading: connLoading, refetch: refetchConn } = trpc.slack.getConnection.useQuery()
  // The desktop-cache bridge (local-chat-cache-ingest) has no OAuth connection row.
  const { data: cache } = trpc.slack.cacheStatus.useQuery()
  const viaCache = !connection?.connected && !!cache?.active
  const hasSlack = !!connection?.connected || viaCache
  const { data: channelData, isLoading: channelsLoading } = trpc.slack.listChannels.useQuery(undefined, {
    enabled: tab === 'channels' && hasSlack,
  })
  // Stable fallback: an inline `= []` default is a new array every render, and the
  // seeding effect below keyed on it re-ran forever ("Maximum update depth exceeded").
  const channelRows = channelData ?? NO_CHANNELS

  const disconnectMut = trpc.slack.disconnect.useMutation({
    onSuccess: async () => {
      setMessage('הסלאק נותק.')
      await utils.slack.getConnection.invalidate()
      refetchConn()
    },
    onError: () => setMessage('לא הצלחתי לנתק. נסה שוב.'),
  })

  const updateChannelMut = trpc.slack.updateChannel.useMutation({
    onSuccess: async () => {
      await utils.slack.listChannels.invalidate()
    },
    onError: () => setMessage('לא הצלחתי לשמור. נסה שוב.'),
  })

  const syncUsersMut = trpc.slack.syncUsers.useMutation({
    onSuccess: (res) => setMessage(`${res.synced} אנשי קשר עודכנו מסלאק.`),
    onError: () => setMessage('שגיאה בסנכרון משתמשים.'),
  })

  const syncChannelsMut = trpc.slack.syncChannels.useMutation({
    onSuccess: async () => {
      setMessage('ערוצים עודכנו.')
      await utils.slack.listChannels.invalidate()
    },
    onError: () => setMessage('שגיאה בסנכרון ערוצים.'),
  })

  // Seed channel drafts from server data
  useEffect(() => {
    setChannels(
      channelRows.map((ch) => ({
        ...ch,
        keywords: Array.isArray(JSON.parse(ch.keywords || '[]'))
          ? (JSON.parse(ch.keywords || '[]') as string[]).join(', ')
          : '',
        expanded: false,
      })),
    )
  }, [channelRows])

  // Handle URL params from OAuth redirect
  useEffect(() => {
    if (searchParams.get('connected')) {
      setMessage('סלאק חובר בהצלחה!')
      setTab('channels')
    } else if (searchParams.get('error')) {
      setMessage(`שגיאה בחיבור: ${searchParams.get('error')}`)
    }
  }, [searchParams])

  function setChannelField(channelId: string, field: keyof ChannelDraft, value: unknown) {
    setChannels((prev) => prev.map((ch) => (ch.channelId === channelId ? { ...ch, [field]: value } : ch)))
  }

  async function saveChannel(ch: ChannelDraft) {
    setSaving(ch.channelId)
    try {
      const kws = ch.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
      await updateChannelMut.mutateAsync({
        channelId: ch.channelId,
        enabled: !!ch.enabled,
        fomoEnabled: !!ch.fomoEnabled,
        fomoThreshold: ch.fomoThreshold,
        fomoWindowMinutes: ch.fomoWindowMinutes,
        keywords: kws,
      })
    } finally {
      setSaving(null)
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'connection', label: 'חיבור' },
    { id: 'channels', label: 'שיחות' },
    { id: 'people', label: 'אנשים מסלאק' },
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-8" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Slack</h1>
      <p className="text-[#888] text-sm mb-6">קריאה בלבד — התחייבויות, FOMO ו-Harness מערוצים נבחרים</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[#222]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'text-[#f0ede6] border-b-2 border-[#e8c547] -mb-px'
                : 'text-[#888] hover:text-[#f0ede6]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status message */}
      {message && (
        <div className="card mb-4 p-3 text-sm text-[#f0ede6] flex items-center justify-between gap-2">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-[#888] hover:text-[#f0ede6] text-xs">✕</button>
        </div>
      )}

      {/* ── Connection tab ─────────────────────────────────────────── */}
      {tab === 'connection' && (
        <div className="space-y-4">
          {connLoading ? (
            <p className="text-[#888] text-sm">טוען...</p>
          ) : viaCache ? (
            <div className="card p-4 space-y-2" data-testid="slack-cache-status">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-lg">●</span>
                <div>
                  <p className="font-semibold text-[#f0ede6]">מחובר דרך אפליקציית Slack במחשב</p>
                  <p className="text-xs text-[#888]">
                    {cache?.lastIngestAt
                      ? `עדכון אחרון ${new Date(cache.lastIngestAt).toLocaleString('he-IL')}`
                      : 'עוד לא הגיעו הודעות'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[#555]">
                הגשר במק קורא את הקאש המקומי של אפליקציית סלאק כל 15 דקות. אין קריאה ל-API של סלאק ולא נשלח כלום.
              </p>
            </div>
          ) : connection?.connected ? (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-lg">●</span>
                <div>
                  <p className="font-semibold text-[#f0ede6]">{connection.teamName}</p>
                  <p className="text-xs text-[#888]">Workspace מחובר · קריאה בלבד</p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  className="btn btn-ghost text-sm"
                  onClick={() => syncUsersMut.mutate()}
                  disabled={syncUsersMut.isPending}
                >
                  סנכרן אנשי קשר
                </button>
                <button
                  className="btn btn-danger text-sm"
                  onClick={() => {
                    if (confirm('לנתק את סלאק?')) disconnectMut.mutate()
                  }}
                  disabled={disconnectMut.isPending}
                >
                  התנתק
                </button>
              </div>
              <p className="text-xs text-[#555]">
                Scopes: {connection.scopes}
              </p>
            </div>
          ) : (
            <div className="card p-6 text-center space-y-4">
              <p className="text-[#888] text-sm">
                חבר את סלאק הארגוני כדי לראות התחייבויות, FOMO ו-Harness מהערוצים שתבחר.
              </p>
              <p className="text-xs text-[#555]">
                האפליקציה תדרוש אישור Admin אם ה-Workspace מחייב אישור לאפליקציות.
              </p>
              <a
                href="/api/slack/oauth"
                className="btn btn-primary inline-block text-sm px-6 py-2"
              >
                התחבר ל-Slack
              </a>
            </div>
          )}

          <div className="card p-4 text-xs text-[#555] space-y-1">
            <p className="font-medium text-[#888] mb-2">איך זה עובד</p>
            <p>המערכת קוראת הודעות מהערוצים שתאשר. לא שולחת כלום.</p>
            <p>הרשאות: channels:read, channels:history, groups:history, users:read</p>
            <p>תיעוד: <code className="text-[#888]">/docs/slack-app-request.md</code></p>
          </div>
        </div>
      )}

      {/* ── Channels tab ─────────────────────────────────────────────── */}
      {tab === 'channels' && (
        <div className="space-y-3">
          {!hasSlack ? (
            <p className="text-[#888] text-sm">חבר את סלאק קודם (לשונית חיבור).</p>
          ) : channelsLoading ? (
            <p className="text-[#888] text-sm">טוען ערוצים...</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#555]">{channels.length} שיחות · הודעות פרטיות מופעלות כברירת מחדל, ערוצים רק אם כתבת או תייגו אותך</p>
                {connection?.connected && (
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => syncChannelsMut.mutate()}
                    disabled={syncChannelsMut.isPending}
                  >
                    רענן רשימה
                  </button>
                )}
              </div>

              {channels.length === 0 && (
                <p className="text-[#888] text-sm">
                  לא נמצאו ערוצים. הזמן את האפליקציה לערוץ ב-Slack ולחץ &quot;רענן רשימה&quot;.
                </p>
              )}

              {KIND_SECTIONS.map((section) => {
                const rows = channels.filter((ch) => (ch.kind ?? 'channel') === section.kind)
                if (rows.length === 0) return null
                return (
                <div key={section.kind} className="space-y-2">
                <p className="text-xs font-semibold text-[#888] pt-2">{section.label} ({rows.length})</p>
              {rows.map((ch) => (
                <div key={ch.channelId} className="card">
                  {/* Channel header row */}
                  <div className="flex items-center gap-3 p-3">
                    <Toggle
                      checked={!!ch.enabled}
                      onChange={(v) => {
                        setChannelField(ch.channelId, 'enabled', v)
                        updateChannelMut.mutate({ channelId: ch.channelId, enabled: v })
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[#f0ede6] truncate">
                        {ch.kind === 'dm' ? '💬' : ch.kind === 'group_dm' ? '👥' : ch.isPrivate ? '🔒' : '#'} {ch.name}
                      </p>
                      {(ch.kind ?? 'channel') === 'channel' && <p className="text-xs text-[#888]">{ch.channelId}</p>}
                    </div>
                    <button
                      className="text-[#888] hover:text-[#f0ede6] text-xs px-2"
                      onClick={() => setChannelField(ch.channelId, 'expanded', !ch.expanded)}
                    >
                      {ch.expanded ? '▲ סגור' : '▼ הגדרות'}
                    </button>
                  </div>

                  {/* Expanded settings */}
                  {ch.expanded && (
                    <div className="border-t border-[#1a1a1a] p-3 space-y-3">
                      {/* FOMO */}
                      <div className="flex items-center gap-3">
                        <Toggle
                          checked={!!ch.fomoEnabled}
                          onChange={(v) => setChannelField(ch.channelId, 'fomoEnabled', v)}
                        />
                        <span className="text-sm text-[#f0ede6]">FOMO</span>
                      </div>
                      {!!ch.fomoEnabled && (
                        <div className="flex items-center gap-3 pr-4 flex-wrap">
                          <label className="text-xs text-[#888]">
                            סף הודעות
                            <input
                              type="number"
                              min={2}
                              max={500}
                              value={ch.fomoThreshold}
                              onChange={(e) => setChannelField(ch.channelId, 'fomoThreshold', Number(e.target.value))}
                              className="input text-xs w-16 mr-2"
                            />
                          </label>
                          <label className="text-xs text-[#888]">
                            בדקות
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={ch.fomoWindowMinutes}
                              onChange={(e) => setChannelField(ch.channelId, 'fomoWindowMinutes', Number(e.target.value))}
                              className="input text-xs w-14 mr-2"
                            />
                          </label>
                        </div>
                      )}
                      {/* Keywords */}
                      <label className="block text-xs text-[#888]">
                        מילות מפתח (מופרדות בפסיק)
                        <input
                          type="text"
                          value={ch.keywords}
                          onChange={(e) => setChannelField(ch.channelId, 'keywords', e.target.value)}
                          placeholder="urgent, דחוף, ..."
                          className="input text-sm mt-1 w-full"
                        />
                      </label>
                      {/* Save */}
                      <div className="flex justify-end">
                        <button
                          className="btn btn-primary text-sm"
                          onClick={() => saveChannel(ch)}
                          disabled={saving === ch.channelId}
                        >
                          {saving === ch.channelId ? 'שומר...' : 'שמור'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
                </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── People tab ───────────────────────────────────────────────── */}
      {tab === 'people' && <SlackPeoplePanel />}
    </div>
  )
}
