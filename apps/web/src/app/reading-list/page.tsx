'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

type StatusFilter = 'all' | 'unread' | 'read'

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'הכל' },
  { id: 'unread', label: 'לא נקרא' },
  { id: 'read', label: 'נקרא' },
]

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function isValidUrl(value: string): boolean {
  return /^https?:\/\/.+/i.test(value.trim())
}

export default function ReadingListPage() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const { data: items, isLoading, isError } = trpc.readingList.list.useQuery(
    { status: filter },
    { retry: false },
  )
  const list = Array.isArray(items) ? items : []

  const flash = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(null), 2500)
  }

  const createMutation = trpc.readingList.create.useMutation({
    onSuccess: () => {
      setUrl('')
      setTitle('')
      setNote('')
      setFormOpen(false)
      setFormError(null)
      flash('נשמר לרשימה')
      utils.readingList.list.invalidate()
    },
    onError: () => setFormError('שמירה נכשלה — נסה שוב'),
  })

  const markReadMutation = trpc.readingList.markRead.useMutation({
    onSuccess: () => utils.readingList.list.invalidate(),
  })

  const deleteMutation = trpc.readingList.delete.useMutation({
    onSuccess: () => {
      setConfirmDelete(null)
      flash('הפריט נמחק')
      utils.readingList.list.invalidate()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidUrl(url)) {
      setFormError('כתובת לא תקינה — ודא שהיא מתחילה ב-http:// או https://')
      return
    }
    if (!title.trim()) {
      setFormError('צריך כותרת לפריט')
      return
    }
    setFormError(null)
    createMutation.mutate({
      url: url.trim(),
      title: title.trim(),
      note: note.trim() || undefined,
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">רשימת קריאה</h1>
          <p className="text-sm text-[#5a688c] mt-1">קישורים ששמרת לקריאה מאוחרת.</p>
        </div>
        <div className="flex items-center gap-2">
          {notice && (
            <span
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                background: '#34d39911',
                color: '#34d399',
                border: '1px solid #34d39933',
              }}
            >
              {notice}
            </span>
          )}
          <button
            type="button"
            className="btn btn-primary text-sm"
            onClick={() => setFormOpen((v) => !v)}
          >
            {formOpen ? 'סגור' : 'הוסף קישור'}
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="card mb-6">
          {/* noValidate: the native type="url" bubble preempts (and can't be styled or
              translated like) our own inline Hebrew errors. type="url" is kept for the
              on-screen keyboard hint on touch devices. */}
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
            <div>
              <label className="label" htmlFor="reading-url">
                קישור
              </label>
              <input
                id="reading-url"
                className="input"
                type="url"
                dir="ltr"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="reading-title">
                כותרת
              </label>
              <input
                id="reading-title"
                className="input"
                placeholder="על מה זה?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="reading-note">
                הערה (אופציונלי)
              </label>
              <input
                id="reading-note"
                className="input"
                placeholder="למה שמרתי את זה"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {formError && <div className="text-sm text-[#fb7185]">{formError}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn btn-primary text-sm"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'שומר...' : 'שמור לרשימה'}
              </button>
              <button
                type="button"
                className="btn btn-ghost text-sm"
                onClick={() => {
                  setFormOpen(false)
                  setFormError(null)
                }}
              >
                ביטול
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-[#1d2b46]">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="btn btn-ghost text-sm px-4 py-2 rounded-b-none"
            style={{
              borderBottom: filter === f.id ? '2px solid #2dd4bf' : '2px solid transparent',
              color: filter === f.id ? '#2dd4bf' : '#647399',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card text-sm text-[#5a688c] text-center py-8">טוען…</div>
      ) : isError ? (
        <div className="card text-sm text-[#fb7185] text-center py-8">
          טעינה נכשלה — רענן את הדף
        </div>
      ) : list.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-3xl mb-2">📚</div>
          <p className="text-sm text-[#5a688c]">
            {filter === 'all'
              ? 'אין עדיין פריטים ברשימת הקריאה. הדבק קישור ותן לו כותרת כדי להתחיל.'
              : 'אין פריטים בסינון הזה.'}
          </p>
          {filter === 'all' && (
            <button
              type="button"
              className="btn btn-primary text-sm mt-4"
              onClick={() => setFormOpen(true)}
            >
              הוסף קישור
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((item) => {
            const read = item.status === 'read'
            return (
              <div key={item.id} className={`card ${read ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`font-medium text-[#eef3fb] hover:text-[#2dd4bf] transition-colors ${
                        read ? 'line-through' : ''
                      }`}
                    >
                      {item.title}
                    </a>
                    <div className="text-xs text-[#38bdf8] mt-1" dir="ltr">
                      {domainOf(item.url)}
                    </div>
                    {item.note && (
                      <p className="text-sm text-[#7a89ab] mt-2">{item.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="btn btn-ghost text-[11px] py-1 px-2"
                      onClick={() =>
                        markReadMutation.mutate({ id: item.id, read: !read })
                      }
                      disabled={markReadMutation.isPending}
                    >
                      {read ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                    </button>
                    {confirmDelete === item.id ? (
                      <>
                        <span className="text-[11px] text-[#7a89ab]">
                          למחוק? לא ניתן לשחזר.
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                          onClick={() => deleteMutation.mutate({ id: item.id })}
                          disabled={deleteMutation.isPending}
                        >
                          מחק
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => setConfirmDelete(null)}
                        >
                          ביטול
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                        onClick={() => setConfirmDelete(item.id)}
                      >
                        מחק
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
