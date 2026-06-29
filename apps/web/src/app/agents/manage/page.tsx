'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface AgentSummary {
  id: string
  name: string
  role: string
}

export default function AgentsManagePage() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const isDirty = content !== savedContent
  const selected = agents.find((a) => a.id === selectedId)

  useEffect(() => {
    async function loadAgents() {
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) throw new Error('Failed to load agents')
        const data = (await res.json()) as { agents: AgentSummary[] }
        setAgents(data.agents)
        if (data.agents[0]) setSelectedId(data.agents[0].id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינת סוכנים')
      } finally {
        setLoadingList(false)
      }
    }
    loadAgents()
  }, [])

  const loadAgentContent = useCallback(async (agentId: string) => {
    setLoadingContent(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`)
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to load agent content')
      }
      const data = (await res.json()) as { content: string }
      setContent(data.content)
      setSavedContent(data.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת הוראות')
      setContent('')
      setSavedContent('')
    } finally {
      setLoadingContent(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadAgentContent(selectedId)
  }, [selectedId, loadAgentContent])

  async function handleSave() {
    if (!selectedId || !isDirty) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(selectedId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save')
      }
      setSavedContent(content)
      setMessage('נשמר בהצלחה')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  function handleSelectAgent(agentId: string) {
    if (isDirty && !window.confirm('יש שינויים שלא נשמרו. להמשיך בלי לשמור?')) {
      return
    }
    setSelectedId(agentId)
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-4rem)]">
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ניהול סוכנים</h1>
          <p className="text-xs text-[#555] mt-1">עריכת הוראות מקובצי A_Agents/*.md</p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-[#e8c547]">שינויים שלא נשמרו</span>
          )}
          <Link href="/agents" className="btn btn-ghost text-sm">
            צ&apos;אט סוכנים
          </Link>
        </div>
      </div>

      {message && (
        <div className="mb-3 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loadingList && (
        <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
          טוען סוכנים...
        </div>
      )}

      {!loadingList && agents.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
          לא נמצאו סוכנים ב-A_Agents/
        </div>
      )}

      {!loadingList && agents.length > 0 && (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
          <div className="lg:w-64 shrink-0 flex flex-col gap-2">
            <label className="text-xs text-[#555] lg:hidden">בחר סוכן</label>
            <select
              className="lg:hidden bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-sm text-[#f0ede6]"
              value={selectedId ?? ''}
              onChange={(e) => handleSelectAgent(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <div className="hidden lg:flex flex-col gap-1 border border-[#1a1a1a] rounded-xl p-2 overflow-y-auto">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleSelectAgent(a.id)}
                  className={`text-right rounded-lg px-3 py-2.5 transition-colors ${
                    selectedId === a.id
                      ? 'bg-[#e8c547]/15 border border-[#e8c547]/30 text-[#f0ede6]'
                      : 'hover:bg-[#1a1a1a] text-[#aaa] border border-transparent'
                  }`}
                >
                  <div className="font-medium text-sm">{a.name}</div>
                  {a.role && (
                    <div className="text-[11px] text-[#555] mt-0.5 line-clamp-2">{a.role}</div>
                  )}
                  <div className="text-[10px] text-[#444] mt-1 font-mono">{a.id}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col border border-[#1a1a1a] rounded-xl overflow-hidden min-h-[400px]">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#1a1a1a] bg-[#111]">
              <div>
                <div className="font-medium text-sm">{selected?.name ?? 'בחר סוכן'}</div>
                {selected && (
                  <div className="text-[10px] text-[#555] font-mono mt-0.5">{selected.id}.md</div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedId || !isDirty || saving || loadingContent}
                onClick={handleSave}
              >
                {saving ? 'שומר...' : 'שמור'}
              </button>
            </div>

            {loadingContent ? (
              <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
                טוען הוראות...
              </div>
            ) : selectedId ? (
              <textarea
                className="input flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed p-4 min-h-0"
                dir="ltr"
                spellCheck={false}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setMessage(null)
                }}
                placeholder="תוכן markdown של הסוכן..."
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
                בחר סוכן לעריכה
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
