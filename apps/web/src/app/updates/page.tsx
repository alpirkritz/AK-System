'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'

const FEED_CATEGORY_KEY = 'ak:updates-category'

type Category = 'all' | 'economics' | 'us_market' | 'ai_tech' | 'israel_market'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'הכל' },
  { id: 'economics', label: 'כלכלה' },
  { id: 'us_market', label: 'בורסה ארה"ב' },
  { id: 'ai_tech', label: 'טק ו-AI' },
  { id: 'israel_market', label: 'בורסה ישראלית' },
]

const CATEGORY_OPTIONS = CATEGORIES.filter((c) => c.id !== 'all') as { id: 'economics' | 'us_market' | 'ai_tech' | 'israel_market'; label: string }[]

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type ViewMode = 'feed' | 'sources'

export default function UpdatesPage() {
  const [view, setView] = useState<ViewMode>('feed')
  const [category, setCategory] = useState<Category>('all')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(FEED_CATEGORY_KEY)
      if (saved && CATEGORIES.some((c) => c.id === saved)) setCategory(saved as Category)
    } catch { /* ignore */ }
  }, [])

  const setCategoryAndSave = (c: Category) => {
    setCategory(c)
    try {
      localStorage.setItem(FEED_CATEGORY_KEY, c)
    } catch { /* ignore */ }
  }
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryResult, setSummaryResult] = useState<string | null>(null)

  const [newSource, setNewSource] = useState({ name: '', url: '', category: 'economics' as 'economics' | 'us_market' | 'ai_tech' | 'israel_market' })
  const [addingSource, setAddingSource] = useState(false)
  const [sourceMessage, setSourceMessage] = useState<string | null>(null)

  const { data: sources = [] } = trpc.feed.listSources.useQuery(undefined, { enabled: view === 'sources' })
  const createSourceMutation = trpc.feed.createSource.useMutation({
    onSuccess: () => {
      setNewSource({ name: '', url: '', category: 'economics' })
      setAddingSource(false)
      setSourceMessage('המקור נוסף. הרץ "סנכרן מקורות" בטאב פיד כדי למשוך כתבות.')
      utils.feed.listSources.invalidate()
    },
    onError: (err) => {
      setSourceMessage(`שגיאה: ${err.message}`)
      setAddingSource(false)
    },
  })
  const deleteSourceMutation = trpc.feed.deleteSource.useMutation({
    onSuccess: () => {
      utils.feed.listSources.invalidate()
      utils.feed.getLatest.invalidate()
      utils.feed.list.invalidate()
    },
  })

  const { data: items, isLoading, isError } = trpc.feed.list.useQuery({
    category: category === 'all' ? undefined : category,
    limit: 80,
  }, { retry: false })
  const list = Array.isArray(items) ? items : []

  const utils = trpc.useUtils()

  const syncMutation = trpc.feed.sync.useMutation({
    onSuccess: (res) => {
      setSyncResult(`נוספו ${res.itemsInserted} פריטים (${res.sourcesInserted} מקורות חדשים)`)
      setSyncing(false)
      utils.feed.getLatest.invalidate()
      utils.feed.list.invalidate()
    },
    onError: (err) => {
      setSyncResult(`שגיאה: ${err.message}`)
      setSyncing(false)
    },
  })

  const summarizeMutation = trpc.feed.generateSummaries.useMutation({
    onSuccess: (res) => {
      setSummaryResult(`עודכנו ${res.updated} פריטים עם תגיות וסיכום AI`)
      setSummarizing(false)
      utils.feed.getLatest.invalidate()
      utils.feed.list.invalidate()
    },
    onError: (err) => {
      setSummaryResult(`שגיאה: ${err.message}`)
      setSummarizing(false)
    },
  })

  const handleSync = () => {
    setSyncing(true)
    setSyncResult(null)
    setSummaryResult(null)
    syncMutation.mutate()
  }

  const handleSummarize = () => {
    setSummarizing(true)
    setSummaryResult(null)
    setSyncResult(null)
    summarizeMutation.mutate({ limit: 10 })
  }

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSource.name.trim() || !newSource.url.trim()) return
    setAddingSource(true)
    setSourceMessage(null)
    createSourceMutation.mutate({
      name: newSource.name.trim(),
      url: newSource.url.trim(),
      category: newSource.category,
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-bold tracking-tight">עדכונים</h1>
        {view === 'feed' && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="btn btn-primary text-sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '⏳ מסנכרן...' : '🔄 סנכרן מקורות'}
          </button>
          <button
            className="btn btn-ghost text-sm"
            onClick={handleSummarize}
            disabled={summarizing}
            style={{ borderColor: '#e8c54744', color: '#e8c547' }}
          >
            {summarizing ? '⏳ יוצר סיכומים...' : '✨ צור סיכומים (AI)'}
          </button>
          {(syncResult || summaryResult) && (
            <span
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                background: (syncResult ?? summaryResult)?.startsWith('שגיאה') ? '#e8477a11' : '#47b86e11',
                color: (syncResult ?? summaryResult)?.startsWith('שגיאה') ? '#e8477a' : '#47b86e',
                border: `1px solid ${(syncResult ?? summaryResult)?.startsWith('שגיאה') ? '#e8477a33' : '#47b86e33'}`,
              }}
            >
              {syncResult ?? summaryResult}
            </span>
          )}
        </div>
        )}
      </div>

      {/* טאבים עליונים: פיד | מקורות */}
      <div className="flex gap-1 mb-6 border-b border-[#1a1a1a]">
        {(['feed', 'sources'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="btn btn-ghost text-sm px-4 py-2 rounded-b-none"
            style={{
              borderBottom: view === v ? '2px solid #e8c547' : '2px solid transparent',
              color: view === v ? '#e8c547' : '#666',
            }}
          >
            {v === 'feed' ? 'פיד' : 'מקורות'}
          </button>
        ))}
      </div>

      {view === 'sources' && (
        <>
          <p className="text-sm text-[#555] mb-4">
            הוסף או הסר מקורות RSS. אחרי שינוי הרץ &quot;סנכרן מקורות&quot; בטאב פיד.
          </p>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="card p-0 overflow-hidden">
              <div className="text-xs font-semibold text-[#666] uppercase tracking-wider px-4 py-3 border-b border-[#1a1a1a]">
                מקורות קיימים ({sources.length})
              </div>
              {sources.length === 0 ? (
                <div className="px-4 py-8 text-sm text-[#555] text-center">אין מקורות. הוסף מקור בטופס.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#222]">
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#555] uppercase">שם</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#555] uppercase">כתובת RSS</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium text-[#555] uppercase">קטגוריה</th>
                      <th className="w-16 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((src) => (
                      <tr key={src.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-4 py-3 font-medium text-[#f0ede6]">{src.name}</td>
                        <td className="px-4 py-3 text-[#888] max-w-[200px] truncate" title={src.url}>{src.url}</td>
                        <td className="px-4 py-3">
                          <span className="pill text-[10px]" style={{ background: '#e8c54722', color: '#e8c547', border: '1px solid #e8c54744' }}>
                            {CATEGORY_OPTIONS.find((c) => c.id === src.category)?.label ?? src.category}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] py-1 px-2 text-[#e8477a] border-[#e8477a22]"
                            onClick={() => deleteSourceMutation.mutate({ id: src.id })}
                            disabled={deleteSourceMutation.isPending}
                          >
                            מחק
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <div className="text-sm font-semibold mb-3">הוסף מקור</div>
              <form onSubmit={handleAddSource} className="flex flex-col gap-3">
                <div>
                  <label className="label">שם (תצוגה)</label>
                  <input
                    className="input"
                    placeholder="למשל: TheMarker"
                    value={newSource.name}
                    onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">כתובת RSS</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
                    value={newSource.url}
                    onChange={(e) => setNewSource((s) => ({ ...s, url: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">קטגוריה</label>
                  <select
                    className="select"
                    value={newSource.category}
                    onChange={(e) => setNewSource((s) => ({ ...s, category: e.target.value as typeof s.category }))}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary mt-1" disabled={addingSource || !newSource.name.trim() || !newSource.url.trim()}>
                  {addingSource ? 'מוסיף...' : 'הוסף מקור'}
                </button>
                {sourceMessage && (
                  <div className="text-xs mt-2 px-3 py-2 rounded-lg" style={{ background: sourceMessage.startsWith('שגיאה') ? '#e8477a11' : '#47b86e11', color: sourceMessage.startsWith('שגיאה') ? '#e8477a' : '#47b86e', border: `1px solid ${sourceMessage.startsWith('שגיאה') ? '#e8477a33' : '#47b86e33'}` }}>
                    {sourceMessage}
                  </div>
                )}
              </form>
            </div>
          </div>
        </>
      )}

      {view === 'feed' && (
        <>
      <p className="text-sm text-[#555] mb-6">
        כלכלה, בורסה בארה&quot;ב, טכנולוגיה ו-AI, בורסה ישראלית — מסוכמים ממקורות נבחרים.
      </p>

      <div className="flex gap-1 mb-6 border-b border-[#1a1a1a] flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryAndSave(c.id)}
            className="btn btn-ghost text-sm px-4 py-2 rounded-b-none"
            style={{
              borderBottom: category === c.id ? '2px solid #e8c547' : '2px solid transparent',
              color: category === c.id ? '#e8c547' : '#666',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-[#555] text-sm">שגיאה בטעינת העדכונים. וודא שהרצת סנכרון פעם אחת מדף זה.</div>
        </div>
      ) : isLoading ? (
        <div className="text-[#555] text-sm py-8">טוען...</div>
      ) : list.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">📰</div>
          <div className="text-[#555] text-sm">אין פריטים בקטגוריה זו</div>
          <div className="text-xs text-[#444] mt-1">לחץ על &quot;סנכרן מקורות&quot; כדי למשוך עדכונים</div>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((item, i) => (
            <div
              key={item?.id ?? `item-${i}`}
              className="card hover:border-[#333] transition-colors"
            >
              <a
                href={item?.link ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="block no-underline"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[#f0ede6] mb-1 overflow-hidden text-ellipsis" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {item?.title ?? ''}
                    </h3>
                    {item?.summary && (
                      <p className="text-xs text-[#666] mb-2 overflow-hidden text-ellipsis" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {item.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="pill text-[10px]"
                        style={{
                          background: '#e8c54722',
                          color: '#e8c547',
                          border: '1px solid #e8c54744',
                        }}
                      >
                        {CATEGORIES.find((x) => x.id === (item?.category ?? ''))?.label ?? item?.category ?? ''}
                      </span>
                      <span className="text-[11px] text-[#555]">{item?.sourceName ?? ''}</span>
                      <span className="text-[11px] text-[#444]">{item?.publishedAt ? fmtDate(item.publishedAt) : ''}</span>
                    </div>
                  </div>
                  <span className="text-[#555] shrink-0" aria-hidden>
                    ↗
                  </span>
                </div>
              </a>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  )
}
