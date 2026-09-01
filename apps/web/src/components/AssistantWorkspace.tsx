'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Sparkles, SlidersHorizontal } from 'lucide-react'

const ChatPanel = dynamic(() => import('@/components/ChatPanel').then((m) => m.ChatPanel), {
  ssr: false,
})
const AgentChatPanel = dynamic(
  () => import('@/components/AgentChatPanel').then((m) => m.AgentChatPanel),
  { ssr: false },
)
const AgentTriggersPanel = dynamic(
  () => import('@/components/AgentTriggersPanel').then((m) => m.AgentTriggersPanel),
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

const GENERAL = '__general__'

export function AssistantWorkspace() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [engine, setEngine] = useState<string>('gemini')
  // Default mode is the general assistant.
  const [selectedId, setSelectedId] = useState<string>(GENERAL)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) throw new Error('failed')
        const data = (await res.json()) as { agents: AgentSummary[]; engine?: string }
        setAgents(data.agents)
        if (data.engine) setEngine(data.engine)
        // Honor ?agent= deep links (e.g. from notifications) by switching mode.
        const params = new URLSearchParams(window.location.search)
        const wanted = params.get('agent')
        if (wanted && data.agents.some((a) => a.id === wanted)) {
          setSelectedId(wanted)
        }
      } catch {
        // Agents are optional; the general assistant always works.
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const isGeneral = selectedId === GENERAL
  const selected = agents.find((a) => a.id === selectedId)

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={22} className="text-[#2dd4bf]" strokeWidth={2} />
          <h1 className="text-2xl font-bold tracking-tight">עוזר</h1>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="assistant-mode" className="text-xs text-[#647399]">
            מצב
          </label>
          <select
            id="assistant-mode"
            className="select w-auto min-w-[180px] text-sm"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loading}
          >
            <option value={GENERAL}>עוזר כללי</option>
            {agents.length > 0 && (
              <optgroup label="סוכנים מומחים">
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {!isGeneral && (
            <Link
              href="/agents/manage"
              className="btn btn-ghost text-sm inline-flex items-center gap-1.5"
            >
              <SlidersHorizontal size={15} strokeWidth={2} />
              הוראות
            </Link>
          )}
        </div>
      </div>

      {isGeneral ? (
        <div className="flex-1 min-h-0 border border-[#2f4368] rounded-xl overflow-hidden">
          <ChatPanel />
        </div>
      ) : selected ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="mb-2 text-xs text-[#647399] shrink-0">
            מדבר עם <span className="text-[#2dd4bf]">{selected.name}</span> ·{' '}
            {ENGINE_LABELS[engine] ?? engine}
          </div>
          <div className="shrink-0">
            <AgentTriggersPanel agentId={selected.id} agentName={selected.name} />
          </div>
          <div className="flex-1 min-h-0 border border-[#2f4368] rounded-xl overflow-hidden">
            <AgentChatPanel
              key={selected.id}
              agentId={selected.id}
              agentName={selected.name}
              engine={engine}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#647399] text-sm">
          טוען…
        </div>
      )}
    </div>
  )
}
