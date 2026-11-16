'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

/**
 * Pending corrections for one agent and the standing rules they became (spec: agent-feedback-loop).
 * Rules are instruction memories linked to `agent:<id>`; they reach this agent's runs only.
 */
export function AgentRulesPanel({ agentId }: { agentId: string }) {
  const utils = trpc.useUtils()
  const pending = trpc.agentFeedback.list.useQuery({ agentId, status: 'pending' })
  const rules = trpc.agentFeedback.rules.list.useQuery({ agentId })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newRule, setNewRule] = useState('')

  const refresh = () => {
    void utils.agentFeedback.list.invalidate()
    void utils.agentFeedback.rules.list.invalidate({ agentId })
  }
  const apply = trpc.agentFeedback.apply.useMutation({ onSuccess: refresh })
  const reject = trpc.agentFeedback.reject.useMutation({ onSuccess: refresh })
  const setEnabled = trpc.agentFeedback.rules.setEnabled.useMutation({ onSuccess: refresh })
  const createRule = trpc.memory.memories.create.useMutation({
    onSuccess: () => {
      setNewRule('')
      refresh()
    },
  })

  type Pending = { id: string; feedback: string; suggestedRule: string | null; createdAt: string }
  type Rule = { memoryId: string; content: string; enabled: boolean }
  const pendingRows = (pending.data ?? []) as Pending[]
  const ruleRows = (rules.data ?? []) as Rule[]

  return (
    <section className="card p-4 space-y-4" data-testid="agent-rules-panel">
      <div>
        <h3 className="text-sm font-medium text-[#eef3fb]">כללים ותיקונים</h3>
        <p className="text-[11px] text-[#5a688c] mt-0.5">
          תיקונים שאמרת להוגו על הסוכן הזה. כלל שהוחל נכנס רק לריצות של הסוכן הזה — כרטיס הסוכן לא משתנה.
        </p>
      </div>

      {pendingRows.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold text-[#97a4c2]">ממתינים לאישור ({pendingRows.length})</div>
          {pendingRows.map((f) => {
            const draft = drafts[f.id] ?? f.suggestedRule ?? ''
            return (
              <div key={f.id} className="rounded-lg border border-[#29395d] p-3 space-y-2" data-testid="agent-feedback-pending">
                <div className="text-[12px] text-[#97a4c2] whitespace-pre-wrap">«{f.feedback}»</div>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                  rows={2}
                  placeholder="נסח כלל אחד שהסוכן צריך לעקוב אחריו"
                  className="input w-full text-[12px]"
                  dir="rtl"
                  aria-label="כלל מוצע"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40"
                    disabled={!draft.trim() || apply.isPending}
                    onClick={() => apply.mutate({ id: f.id, rule: draft.trim() })}
                  >
                    החל
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px] py-1.5 px-3"
                    disabled={reject.isPending}
                    onClick={() => reject.mutate({ id: f.id })}
                  >
                    דחה
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-[#97a4c2]">כללים פעילים</div>
        {ruleRows.length === 0 ? (
          <p className="text-[11px] text-[#5a688c]">אין כללים לסוכן הזה.</p>
        ) : (
          <ul className="space-y-1.5">
            {ruleRows.map((r) => (
              <li key={r.memoryId} className="flex items-start justify-between gap-3" data-testid="agent-rule">
                <span className={`text-[12px] leading-relaxed ${r.enabled ? 'text-[#cdd7ea]' : 'text-[#5a688c] line-through'}`}>
                  {r.content}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2 shrink-0"
                  onClick={() => setEnabled.mutate({ memoryId: r.memoryId, enabled: !r.enabled })}
                >
                  {r.enabled ? 'כבה' : 'הפעל'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault()
            const content = newRule.trim()
            if (!content) return
            createRule.mutate({
              content,
              kind: 'instruction',
              source: 'manual',
              links: [{ kind: 'agent', entityId: agentId }],
            })
          }}
        >
          <input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            placeholder="הוסף כלל לסוכן הזה…"
            className="input text-[12px] py-1.5 flex-1"
            dir="rtl"
            aria-label="כלל חדש"
          />
          <button type="submit" className="btn btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40" disabled={!newRule.trim() || createRule.isPending}>
            הוסף
          </button>
        </form>
      </div>
    </section>
  )
}
