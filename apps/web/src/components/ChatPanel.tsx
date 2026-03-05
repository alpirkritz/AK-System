'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  source: 'web' | 'telegram' | 'cron'
  createdAt: string
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  async function loadHistory() {
    try {
      const res = await fetch('/api/chat/history?limit=100')
      if (!res.ok) return
      const data = (await res.json()) as { messages: ChatMessage[] }
      setMessages(data.messages)
    } catch {
      // ignore
    } finally {
      setInitialLoading(false)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const tempUserMsg: ChatMessage = {
      id: 'tmp_' + Date.now(),
      role: 'user',
      content: text,
      source: 'web',
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || 'Chat request failed')
      }
      const data = (await res.json()) as { userMessage: string; assistantMessage: string }
      const assistantMsg: ChatMessage = {
        id: 'tmp_a_' + Date.now(),
        role: 'assistant',
        content: data.assistantMessage,
        source: 'web',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: 'tmp_e_' + Date.now(),
        role: 'system',
        content: err instanceof Error ? err.message : 'שגיאה בשליחה',
        source: 'web',
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
      const d = new Date(iso)
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  function sourceTag(source: string) {
    if (source === 'telegram') return 'Telegram'
    if (source === 'cron') return 'מערכת'
    return null
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#555] text-sm">טוען היסטוריה...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <div className="text-3xl opacity-30">💬</div>
            <p className="text-[#555] text-sm">שאל שאלה או בקש משהו מהמערכת</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#e8c547] text-[#0a0a0a] rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-[#2a1a1a] text-red-300 border border-red-900/30 rounded-bl-sm'
                    : 'bg-[#1a1a1a] text-[#f0ede6] rounded-bl-sm'
              }`}
            >
              {sourceTag(msg.source) && (
                <span className="inline-block text-[10px] font-medium uppercase tracking-wider opacity-50 mb-1">
                  {sourceTag(msg.source)}
                </span>
              )}
              <div>{msg.content}</div>
              <div
                className={`text-[10px] mt-1 ${
                  msg.role === 'user' ? 'text-[#0a0a0a]/40' : 'text-[#555]'
                }`}
              >
                {formatTime(msg.createdAt)}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a1a1a] rounded-xl px-4 py-3 text-sm text-[#555]">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-[#1a1a1a] px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="כתוב הודעה..."
            disabled={loading}
            className="flex-1 bg-[#111] border border-[#222] rounded-lg px-4 py-2.5 text-sm text-[#f0ede6] placeholder:text-[#444] focus:outline-none focus:border-[#e8c547]/50 transition-colors disabled:opacity-50"
            dir="auto"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-[#e8c547] text-[#0a0a0a] rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#d4b43e] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            שלח
          </button>
        </div>
      </div>
    </div>
  )
}
