'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import {
  MemoryLinkAdder,
  MemoryLinkChipView,
  MemoryLinkEditor,
  linkKey,
  type MemoryLinkChip,
} from '@/components/memory/MemoryLinkEditor'
import { OwnerProfileCard } from '@/components/memory/OwnerProfileCard'
import { MemoryProposals } from '@/components/memory/MemoryProposals'

type KindFilter = 'all' | 'memory' | 'knowledge' | 'instruction'
type NewKind = 'memory' | 'knowledge'
type ScopeFilter = 'all' | 'global' | 'scoped'

/** Debounce a value so link suggestions are not fetched on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function listFilter(kind: KindFilter, scope: ScopeFilter, entity: MemoryLinkChip | null) {
  const f: Record<string, string> = {}
  if (kind !== 'all') f.kind = kind
  if (entity) {
    const key = { person: 'personId', project: 'projectId', workspace: 'workspaceId', topic: 'topic', agent: 'agentId' }[entity.kind]
    f[key] = entity.entityId
  } else if (scope !== 'all') {
    f.scope = scope
  }
  return Object.keys(f).length > 0 ? f : undefined
}

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
  const [showProposals, setShowProposals] = useState(false)
  const { data: proposalCount } = trpc.memory.proposals.count.useQuery()
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [entityFilter, setEntityFilter] = useState<MemoryLinkChip | null>(null)
  const { data: memories = [], isLoading } = trpc.memory.memories.list.useQuery(
    listFilter(kindFilter, scopeFilter, entityFilter) as Parameters<typeof trpc.memory.memories.list.useQuery>[0],
  )

  const [newContent, setNewContent] = useState('')
  const [newKind, setNewKind] = useState<NewKind>('memory')
  // Suggested links (pre-checked) + links the user added by hand.
  const debouncedContent = useDebounced(newContent.trim(), 400)
  const { data: suggested } = trpc.memory.memories.suggestLinks.useQuery(
    { content: debouncedContent },
    { enabled: debouncedContent.length >= 2 },
  )
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [manualLinks, setManualLinks] = useState<MemoryLinkChip[]>([])
  const suggestions = debouncedContent.length >= 2 ? ((suggested?.links ?? []) as MemoryLinkChip[]) : []
  const newLinks = [...suggestions, ...manualLinks].filter(
    (l, i, all) => !excluded.has(linkKey(l)) && all.findIndex((x) => linkKey(x) === linkKey(l)) === i,
  )

  // "What Hugo would see" tester
  const [probe, setProbe] = useState('')
  const [probeSubmitted, setProbeSubmitted] = useState('')
  const relevant = trpc.memory.relevant.useQuery({ message: probeSubmitted }, { enabled: probeSubmitted.length > 0 })

  const createMemory = trpc.memory.memories.create.useMutation({
    onSuccess: () => {
      setNewContent('')
      setExcluded(new Set())
      setManualLinks([])
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
          הוראות קבועות, זיכרונות וידע — נשמרים תמיד. זיכרון כללי נכנס לכל שיחה; זיכרון שמקושר לאדם, פרויקט
          או נושא נכנס רק כשהשיחה עוסקת בהם.
          עדיפויות ופתוחות שראש מטה צריך לזכור — השתמש בתגיות [עדיפות] / [לולאה פתוחה].
        </p>
      </div>

      {message && (
        <div className="mb-4 text-xs px-4 py-2 rounded-lg bg-[#1d2b46] border border-[#29395d] text-[#97a4c2]">
          {message}
        </div>
      )}

      <OwnerProfileCard />

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
        <div className="space-y-2">
          <div className="text-[11px] text-[#5a688c]">
            {newLinks.length === 0 && suggestions.length === 0
              ? 'בלי קישור — הזיכרון יהיה כללי ויכנס לכל שיחה.'
              : 'מקושר ל:'}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[...suggestions, ...manualLinks]
              .filter((l, i, all) => all.findIndex((x) => linkKey(x) === linkKey(l)) === i)
              .map((l) => {
                const off = excluded.has(linkKey(l))
                return (
                  <MemoryLinkChipView
                    key={linkKey(l)}
                    link={l}
                    muted={off}
                    onClick={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev)
                        if (off) next.delete(linkKey(l))
                        else next.add(linkKey(l))
                        return next
                      })
                    }
                  />
                )
              })}
          </div>
          <MemoryLinkAdder
            onAdd={(l) => {
              setManualLinks((prev) => (prev.some((x) => linkKey(x) === linkKey(l)) ? prev : [...prev, l]))
              setExcluded((prev) => {
                const next = new Set(prev)
                next.delete(linkKey(l))
                return next
              })
            }}
          />
        </div>
        <button
          onClick={() => {
            if (!newContent.trim()) return
            createMemory.mutate({
              content: newContent.trim(),
              kind: newKind,
              source: 'manual',
              links: newLinks.map((l) => ({ kind: l.kind, entityId: l.entityId })),
            })
          }}
          disabled={!newContent.trim() || createMemory.isPending}
          className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-40"
        >
          {createMemory.isPending ? 'מוסיף…' : 'הוסף'}
        </button>
      </div>

      {/* What Hugo would see */}
      <details className="card p-5 mb-6" data-testid="memory-tester">
        <summary className="text-sm font-semibold text-[#cdd7ea] cursor-pointer">מה הוגו יראה</summary>
        <div className="text-xs text-[#5a688c] mt-2">
          כתוב הודעה כמו שהיית שולח להוגו, וראה אילו זיכרונות ייכנסו לשיחה. (בלי היומן של היום, שגם הוא מוסיף הקשר.)
        </div>
        <form
          className="flex gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            setProbeSubmitted(probe.trim())
          }}
        >
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            placeholder="לדוגמה: תכין אותי לפגישה עם דן על DD"
            className="input text-[13px] flex-1"
            dir="rtl"
          />
          <button type="submit" disabled={!probe.trim()} className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-40">
            בדוק
          </button>
        </form>
        {relevant.data && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#5a688c]">זוהו:</span>
              {relevant.data.anchors.length === 0 ? (
                <span className="text-[11px] text-[#5a688c]">אף ישות — רק זיכרון כללי ייכנס</span>
              ) : (
                relevant.data.anchors.map((a) => <MemoryLinkChipView key={linkKey(a)} link={a as MemoryLinkChip} />)
              )}
            </div>
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-[#111b30] border border-[#29395d] rounded-lg p-3 text-[#97a4c2] max-h-80 overflow-auto" dir="auto">
              {relevant.data.block || '(ריק — אין מה להזריק)'}
            </pre>
            {relevant.data.dropped.length > 0 && (
              <div className="text-[11px] text-[#e8a547]">
                {relevant.data.dropped.length} זיכרונות לא נכנסו בגלל מגבלת האורך.
              </div>
            )}
          </div>
        )}
      </details>

      {/* Memory list */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {(
          [
            { id: 'all', label: 'כל הקישורים' },
            { id: 'global', label: 'כלליים' },
            { id: 'scoped', label: 'מקושרים' },
          ] as { id: ScopeFilter; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setScopeFilter(t.id)
              setEntityFilter(null)
            }}
            className="text-[12px] px-2.5 py-1 rounded-lg transition-all cursor-pointer"
            style={{
              background: !entityFilter && scopeFilter === t.id ? '#2dd4bf22' : 'transparent',
              color: !entityFilter && scopeFilter === t.id ? '#2dd4bf' : '#647399',
              border: `1px solid ${!entityFilter && scopeFilter === t.id ? '#2dd4bf44' : '#29395d'}`,
            }}
          >
            {t.label}
          </button>
        ))}
        {entityFilter && (
          <span className="flex items-center gap-1.5 text-[11px] text-[#97a4c2]">
            מסונן לפי:
            <MemoryLinkChipView link={entityFilter} onRemove={() => setEntityFilter(null)} />
          </span>
        )}
      </div>
      <div className="flex gap-2 mb-4 border-b border-[#1d2b46] pb-3">
        {kindTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setKindFilter(t.id)
              setShowProposals(false)
            }}
            className="text-sm px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            style={{
              background: !showProposals && kindFilter === t.id ? '#2dd4bf22' : 'transparent',
              color: !showProposals && kindFilter === t.id ? '#2dd4bf' : '#647399',
              border: `1px solid ${!showProposals && kindFilter === t.id ? '#2dd4bf44' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setShowProposals(true)}
          className="text-sm px-3 py-1.5 rounded-lg transition-all cursor-pointer"
          style={{
            background: showProposals ? '#2dd4bf22' : 'transparent',
            color: showProposals ? '#2dd4bf' : '#647399',
            border: `1px solid ${showProposals ? '#2dd4bf44' : 'transparent'}`,
          }}
          data-testid="memory-proposals-tab"
        >
          הצעות{proposalCount?.pending ? ` (${proposalCount.pending})` : ''}
        </button>
      </div>

      {showProposals ? (
        <MemoryProposals />
      ) : isLoading ? (
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
                  <div className="mt-2">
                    <MemoryLinkEditor
                      memoryId={m.id}
                      links={(m.links ?? []) as MemoryLinkChip[]}
                      onFilter={(l) => setEntityFilter(l)}
                    />
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
