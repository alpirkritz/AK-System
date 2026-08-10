'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  source: 'web' | 'telegram' | 'whatsapp' | 'cron'
  createdAt: string
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Notification deep link: /chat?message=<id>. Read from the URL rather than
  // useSearchParams so this stays a client-only concern and /chat keeps its
  // static render.
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [highlightOn, setHighlightOn] = useState(false)
  const linkedHandled = useRef(false)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('message')?.trim()
    if (id) {
      setLinkedId(id)
      setHighlightOn(true)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/history?limit=100')
      if (!res.ok) return
      const data = (await res.json()) as { messages: ChatMessage[] }
      setMessages((prev) => {
        const last = data.messages[data.messages.length - 1]
        const prevLast = prev[prev.length - 1]
        if (prev.length === data.messages.length && last?.id === prevLast?.id) {
          return prev
        }
        return data.messages
      })
    } catch {
      // ignore
    } finally {
      setInitialLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (messages.length > 0 && linkedId && !linkedHandled.current) {
      const target = messageRefs.current.get(linkedId)
      if (target) {
        linkedHandled.current = true
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      // Referenced message is not in the loaded history — fall back to the bottom.
      if (!initialLoading) linkedHandled.current = true
    }
    scrollToBottom()
  }, [messages, linkedId, initialLoading, scrollToBottom])

  useEffect(() => {
    if (!highlightOn) return
    const timer = setTimeout(() => setHighlightOn(false), 2500)
    return () => clearTimeout(timer)
  }, [highlightOn])

  // Surface messages pushed from other channels (WhatsApp, cron, agents) and after
  // a push notification reopens the app. Polls while visible; refreshes on focus.
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === 'visible' && !loading) loadHistory()
    }
    const interval = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loading, loadHistory])

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
    if (source === 'whatsapp') return 'WhatsApp'
    if (source === 'cron') return 'מערכת'
    return null
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#5a688c] text-sm">טוען היסטוריה...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 w-full max-w-3xl mx-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <div className="text-3xl opacity-30">💬</div>
            <p className="text-[#5a688c] text-sm">שאל שאלה או בקש משהו מהמערכת</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            ref={(el) => {
              if (el) messageRefs.current.set(msg.id, el)
              else messageRefs.current.delete(msg.id)
            }}
            data-message-id={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap transition-shadow duration-300 ${
                msg.role === 'user'
                  ? 'bg-[#2dd4bf] text-[#0a1120] rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-[#34203a] text-red-300 border border-red-900/30 rounded-bl-sm'
                    : 'bg-[#1d2b46] text-[#eef3fb] rounded-bl-sm'
              } ${
                highlightOn && msg.id === linkedId
                  ? 'ring-2 ring-[#2dd4bf] ring-offset-2 ring-offset-[#0a1120]'
                  : ''
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
      <div className="border-t border-[#1d2b46] px-4 py-3">
        <div className="flex items-center gap-2 w-full max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="כתוב הודעה..."
            disabled={loading}
            className="flex-1 bg-[#111b30] border border-[#29395d] rounded-lg px-4 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#4d659c] focus:outline-none focus:border-[#2dd4bf]/50 transition-colors disabled:opacity-50"
            dir="auto"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-[#2dd4bf] text-[#0a1120] rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#14b8a6] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            שלח
          </button>
        </div>
      </div>
    </div>
  )
}
