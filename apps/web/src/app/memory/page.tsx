'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type KindFilter = 'all' | 'memory' | 'knowledge' | 'instruction'
type NewKind = 'memory' | 'knowledge'

const KIND_LABEL: Record<string, string> = {
  memory: 'זיכרון',
  knowledge: 'ידע',
  instruction: 'הוראה',
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'ידני',
  auto: 'אוטומטי',
  chat: 'משיחה',
}

export default function MemoryPage() {
  const utils = trpc.useUtils()
  const [message, setMessage] = useState<string | null>(null)

  // ── Standing instructions ───────────────────────────────────────────────────
  const { data: instructions } = trpc.memory.instructions.get.useQuery()
  const [instrText, setInstrText] = useState('')
  const [instrDirty, setInstrDirty] = useState(false)
  useEffect(() => {
    if (instructions && !instrDirty) setInstrText(instructions.content)
  }, [instructions, instrDirty])

  const setInstructions = trpc.memory.instructions.set.useMutation({
    onSuccess: () => {
      setInstrDirty(false)
      setMessage('ההוראות נשמרו')
      void utils.memory.instructions.get.invalidate()
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })

  // ── Memories ────────────────────────────────────────────────────────────────
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const { data: memories = [], isLoading } = trpc.memory.memories.list.useQuery(
    kindFilter === 'all' ? undefined : { kind: kindFilter },
  )

  const [newContent, setNewContent] = useState('')
  const [newKind, setNewKind] = useState<NewKind>('memory')

  const createMemory = trpc.memory.memories.create.useMutation({
    onSuccess: () => {
      setNewContent('')
      setMessage('נוסף לזיכרון')
      void utils.memory.memories.list.invalidate()
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })
  const updateMemory = trpc.memory.memories.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      void utils.memory.memories.list.invalidate()
    },
    onError: (e) => setMessage(`שגיאה: ${e.message}`),
  })
  const togglePin = trpc.memory.memories.togglePin.useMutation({
    onSuccess: () => void utils.memory.memories.list.invalidate(),
  })
  const deleteMemory = trpc.memory.memories.delete.useMutation({
    onSuccess: () => void utils.memory.memories.list.invalidate(),
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const kindTabs: { id: KindFilter; label: string }[] = [
    { id: 'all', label: 'הכל' },
    { id: 'memory', label: 'זיכרונות' },
    { id: 'knowledge', label: 'ידע' },
    { id: 'instruction', label: 'הוראות' },
  ]

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <h1 className="text-xl font-bold mt-2">זיכרון והוראות לראש מטה</h1>
        <p className="text-xs text-[#5a688c] mt-1">
          הוראות קבועות, זיכרונות וידע — נשמרים תמיד ומוזרקים אוטומטית לכל שיחה עם הסוכנים.
          עדיפויות ופתוחות שראש מטה צריך לזכור — השתמש בתגיות [עדיפות] / [לולאה פתוחה].
        </p>
      </div>

      {message && (
        <div className="mb-4 text-xs px-4 py-2 rounded-lg bg-[#1d2b46] border border-[#29395d] text-[#97a4c2]">
          {message}
        </div>
      )}

      {/* Standing instructions */}
      <div className="card p-5 mb-6 space-y-3">
        <div>
          <div className="text-sm font-semibold text-[#cdd7ea]">הוראות קבועות</div>
          <div className="text-xs text-[#5a688c] mt-0.5">
            איך ראש מטה והסוכנים צריכים לעבוד תמיד. לדוגמה: "תמיד תענה בקצרה", "אל תציע לפתוח Notion".
          </div>
        </div>
        <textarea
          value={instrText}
          onChange={(e) => {
            setInstrText(e.target.value)
            setInstrDirty(true)
          }}
          rows={6}
          placeholder="כתוב כאן הוראות קבועות…"
          className="w-full text-[13px] leading-relaxed bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#cdd7ea] resize-y"
          dir="rtl"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setInstructions.mutate({ content: instrText, enabled: true })}
            disabled={setInstructions.isPending || !instrDirty}
            className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-40"
          >
            {setInstructions.isPending ? 'שומר…' : 'שמור הוראות'}
          </button>
          {instrDirty && <span className="text-[11px] text-[#2dd4bf]">שינויים לא שמורים</span>}
        </div>
      </div>

      {/* Add memory */}
      <div className="card p-5 mb-6 space-y-3">
        <div className="text-sm font-semibold text-[#cdd7ea]">הוסף זיכרון / ידע</div>
        <div className="flex gap-1.5">
          {(['memory', 'knowledge'] as NewKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setNewKind(k)}
              className="text-[12px] px-3 py-1.5 rounded-lg transition-all cursor-pointer"
              style={{
                background: newKind === k ? '#2dd4bf22' : '#1d2b46',
                color: newKind === k ? '#2dd4bf' : '#647399',
                border: `1px solid ${newKind === k ? '#2dd4bf44' : '#29395d'}`,
              }}
            >
              {k === 'memory' ? 'זיכרון קצר' : 'ידע (תוכן ארוך)'}
            </button>
          ))}
        </div>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={newKind === 'knowledge' ? 6 : 3}
          placeholder={
            newKind === 'knowledge'
              ? 'הדבק כאן תוכן ארוך (מסמך, פרטים על אדם/פרויקט)…'
              : 'לדוגמה: אני מעדיף פגישות בבוקר; קוראים לשותף שלי דני'
          }
          className="w-full text-[13px] leading-relaxed bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#cdd7ea] resize-y"
          dir="rtl"
        />
        <button
          onClick={() => {
            if (!newContent.trim()) return
            createMemory.mutate({ content: newContent.trim(), kind: newKind, source: 'manual' })
          }}
          disabled={!newContent.trim() || createMemory.isPending}
          className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-40"
        >
          {createMemory.isPending ? 'מוסיף…' : 'הוסף'}
        </button>
      </div>

      {/* Memory list */}
      <div className="flex gap-2 mb-4 border-b border-[#1d2b46] pb-3">
        {kindTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setKindFilter(t.id)}
            className="text-sm px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            style={{
              background: kindFilter === t.id ? '#2dd4bf22' : 'transparent',
              color: kindFilter === t.id ? '#2dd4bf' : '#647399',
              border: `1px solid ${kindFilter === t.id ? '#2dd4bf44' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-xs text-[#4d659c]">טוען…</div>
      ) : memories.length === 0 ? (
        <div className="card p-6 text-center text-sm text-[#5a688c]">אין פריטים עדיין.</div>
      ) : (
        <div className="space-y-3">
          {memories.map((m) => (
            <div key={m.id} className="card p-4">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="w-full text-[13px] leading-relaxed bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-[#cdd7ea] resize-y"
                    dir="rtl"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateMemory.mutate({ id: m.id, content: editContent })}
                      disabled={updateMemory.isPending || !editContent.trim()}
                      className="btn btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40"
                    >
                      שמור
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn btn-ghost text-[11px] py-1.5 px-3"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[13px] leading-relaxed text-[#cdd7ea] whitespace-pre-wrap flex-1">
                      {m.pinned && <span className="mr-1">📌</span>}
                      {m.content}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[#1d2b46]">
                    <div className="text-[10px] text-[#5a688c]">
                      {KIND_LABEL[m.kind] ?? m.kind} · {SOURCE_LABEL[m.source] ?? m.source}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => togglePin.mutate({ id: m.id, pinned: !m.pinned })}
                        className="btn btn-ghost text-[11px] py-1 px-2"
                      >
                        {m.pinned ? 'בטל נעיצה' : 'נעץ'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(m.id)
                          setEditContent(m.content)
                        }}
                        className="btn btn-ghost text-[11px] py-1 px-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('למחוק את הפריט?')) deleteMemory.mutate({ id: m.id })
                        }}
                        className="btn btn-ghost text-[11px] py-1 px-2 text-red-400"
                      >
                        מחק
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
