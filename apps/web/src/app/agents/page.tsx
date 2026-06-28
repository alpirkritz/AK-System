'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

const AgentChatPanel = dynamic(
  () => import('@/components/AgentChatPanel').then((m) => m.AgentChatPanel),
  { ssr: false },
)

interface AgentSummary {
  id: string
  name: string
  role: string
}

const ENGINE_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  cursor: 'Cursor SDK',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [engine, setEngine] = useState<string>('gemini')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) throw new Error('Failed to load agents')
        const data = (await res.json()) as { agents: AgentSummary[]; engine?: string }
        setAgents(data.agents)
        if (data.engine) setEngine(data.engine)
        if (data.agents.length > 0) {
          setSelectedId(data.agents[0]!.id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינת סוכנים')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const selected = agents.find((a) => a.id === selectedId)

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-4rem)]">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold tracking-tight">סוכנים</h1>
        <span className="text-xs text-[#555]">ABC · {ENGINE_LABELS[engine] ?? engine}</span>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
          טוען סוכנים...
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && agents.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
          לא נמצאו סוכנים ב-A_Agents/
        </div>
      )}

      {!loading && !error && agents.length > 0 && (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
          {/* Agent picker — sidebar on desktop, dropdown on mobile */}
          <div className="lg:w-64 shrink-0 flex flex-col gap-2">
            <label className="text-xs text-[#555] lg:hidden">בחר סוכן</label>
            <select
              className="lg:hidden bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-sm text-[#f0ede6]"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
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
                  onClick={() => setSelectedId(a.id)}
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

          {/* Chat */}
          <div className="flex-1 border border-[#1a1a1a] rounded-xl overflow-hidden min-h-[400px]">
            {selected ? (
              <AgentChatPanel
                key={selected.id}
                agentId={selected.id}
                agentName={selected.name}
                engine={engine}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[#555] text-sm">
                בחר סוכן
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
