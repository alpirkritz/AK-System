'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { scrollElementToBottom } from '@/lib/chat-layout'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

interface AgentChatPanelProps {
  agentId: string
  agentName: string
  engine?: string
}

const ENGINE_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  cursor: 'Cursor SDK',
}

export function AgentChatPanel({ agentId, agentName, engine = 'gemini' }: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const messagesListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    const list = messagesListRef.current
    if (list) scrollElementToBottom(list)
  }, [])

  const loadHistory = useCallback(async () => {
    setInitialLoading(true)
    try {
      const res = await fetch(`/api/agents/history?agentId=${encodeURIComponent(agentId)}`)
      if (!res.ok) return
      const data = (await res.json()) as { messages: ChatMessage[] }
      setMessages(data.messages)
    } catch {
      // ignore
    } finally {
      setInitialLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const tempUserMsg: ChatMessage = {
      id: 'tmp_' + Date.now(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: text }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || 'Agent request failed')
      }
      const data = (await res.json()) as { assistantMessage: string }
      const assistantMsg: ChatMessage = {
        id: 'tmp_a_' + Date.now(),
        role: 'assistant',
        content: data.assistantMessage,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: 'tmp_e_' + Date.now(),
        role: 'system',
        content: err instanceof Error ? err.message : 'שגיאה בשליחה',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function formatTime(iso: string) {
    try {
      return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#5a688c] text-sm">טוען היסטוריה...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 py-2 border-b border-[#1d2b46] text-xs text-[#647399]">
        מדבר עם <span className="text-[#2dd4bf]">{agentName}</span> · {ENGINE_LABELS[engine] ?? engine}
      </div>

      <div
        ref={messagesListRef}
        data-testid="agent-chat-messages"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <div className="text-3xl opacity-30">🤖</div>
            <p className="text-[#5a688c] text-sm max-w-sm">
              שאל את {agentName} — הסוכן רץ דרך {ENGINE_LABELS[engine] ?? engine} עם גישה ללוח שנה, משימות ו-ABC workspace
              {agentId.includes('morning') || agentId.includes('calendar') ? ' ו-Notion' : ''}.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#2dd4bf] text-[#0a1120] rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-[#34203a] text-red-300 border border-red-900/30 rounded-bl-sm'
                    : 'bg-[#1d2b46] text-[#eef3fb] rounded-bl-sm'
              }`}
            >
              <div>{msg.content}</div>
              <div
                className={`text-[10px] mt-1 ${
                  msg.role === 'user' ? 'text-[#0a1120]/40' : 'text-[#5a688c]'
                }`}
              >
                {formatTime(msg.createdAt)}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1d2b46] rounded-xl px-4 py-3 text-sm text-[#5a688c]">
              <span className="inline-flex gap-1 items-center">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
                <span className="mr-2 text-[#4d659c]">הסוכן חושב...</span>
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        data-testid="agent-chat-composer"
        className="shrink-0 sticky bottom-0 z-10 border-t border-[#1d2b46] px-4 py-3 bg-[#0e1626] md:static"
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              scrollToBottom()
              window.scrollTo(0, 0)
            }}
            placeholder="כתוב הודעה לסוכן..."
            disabled={loading}
            className="flex-1 min-w-0 min-h-[44px] bg-[#111b30] border border-[#29395d] rounded-lg px-4 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#4d659c] focus:outline-none focus:border-[#2dd4bf]/50 transition-colors disabled:opacity-50"
            dir="auto"
            aria-label="הודעה לסוכן"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="btn btn-primary min-h-[44px] min-w-[44px] bg-[#2dd4bf] text-[#0a1120] rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#14b8a6] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            שלח
          </button>
        </div>
      </div>
    </div>
  )
}
