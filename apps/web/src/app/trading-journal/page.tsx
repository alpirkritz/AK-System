'use client'

import { IBM_Plex_Mono } from 'next/font/google'
import { useCallback, useEffect, useRef, useState } from 'react'
import './trading-journal.css'

const STORAGE_KEY = 'ak_trading_journal_trades'

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
})

export type TradeRecord = {
  date: string | null
  ticker: string
  setup_type: string
  direction: string
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  r_multiple_entry: number | null
  position_size: number | null
  execution_quality: number | null
  emotional_state: string
  result: string
  actual_r: number | null
  did_right: string
  would_change: string
}

type ChatLine = { role: 'user' | 'ai'; text: string }

function loadTrades(): TradeRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as TradeRecord[]) : []
  } catch {
    return []
  }
}

function parsePart1AndJson(aiResponse: string): { part1: string; trade: TradeRecord | null } {
  const withoutPart2Label = aiResponse.split('PART 2:')[0] ?? aiResponse
  const part1 = withoutPart2Label.replace(/^PART 1:\s*/i, '').trim()

  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { part1, trade: null }

  try {
    const tradeData = JSON.parse(jsonMatch[0]) as TradeRecord
    return { part1, trade: tradeData }
  } catch {
    return { part1, trade: null }
  }
}

function normalizeExecutionQuality(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n)))
}

export default function TradingJournalPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [messages, setMessages] = useState<ChatLine[]>([
    { role: 'ai', text: 'Tell me about your last trade.' },
  ])
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTrades(loadTrades())
  }, [])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    let cancelled = false
    fetch('/api/trading-journal')
      .then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((data) => {
        if (!cancelled) setConfigured(Boolean(data.configured))
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persistTrades = useCallback((next: TradeRecord[]) => {
    setTrades(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const appendMessage = useCallback((role: ChatLine['role'], text: string) => {
    setMessages((m) => [...m, { role, text }])
  }, [])

  const callJournal = useCallback(async (content: string) => {
    const res = await fetch('/api/trading-journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content }),
    })
    const data = (await res.json()) as { text?: string; error?: string }
    if (!res.ok) {
      throw new Error(data.error || 'Request failed')
    }
    if (!data.text) throw new Error('Empty response')
    return data.text
  }, [])

  const onSubmit = async () => {
    const text = input.trim()
    if (!text || busy) return

    setInput('')
    appendMessage('user', text)
    setBusy(true)

    try {
      const aiResponse = await callJournal(text)
      const { part1, trade } = parsePart1AndJson(aiResponse)
      appendMessage('ai', part1 || aiResponse)

      if (trade && typeof trade === 'object' && 'ticker' in trade) {
        const normalized: TradeRecord = {
          ...trade,
          execution_quality: normalizeExecutionQuality(trade.execution_quality),
        }
        setTrades((prev) => {
          const next = [normalized, ...prev]
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
          return next
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error connecting to AI.'
      appendMessage('ai', msg)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSubmit()
    }
  }

  const requestReview = async () => {
    if (trades.length === 0) {
      appendMessage('ai', 'No trades to review yet.')
      return
    }
    if (busy) return
    appendMessage('user', 'Perform a performance review on my last trades.')
    setBusy(true)
    try {
      const context = JSON.stringify(trades.slice(0, 10))
      const aiResponse = await callJournal('REVIEW THIS LOG: ' + context)
      appendMessage('ai', aiResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error connecting to AI.'
      appendMessage('ai', msg)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    if (!confirm('Wipe all trades?')) return
    persistTrades([])
  }

  const rDots = (q: number | null | undefined) => {
    const n = normalizeExecutionQuality(q)
    return '●'.repeat(n) + '○'.repeat(5 - n)
  }

  return (
    <div
      className={`trading-journal-page ${ibmPlexMono.variable}`}
      style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
    >
      {configured === false && (
        <div className="tj-banner">
          Add <code style={{ color: '#e0e0e0' }}>ANTHROPIC_API_KEY</code> to{' '}
          <code style={{ color: '#e0e0e0' }}>apps/web/.env.local</code> (server-side only). Optional:{' '}
          <code style={{ color: '#e0e0e0' }}>ANTHROPIC_MODEL</code> (default claude-3-5-sonnet-20241022).
        </div>
      )}
      <div className="tj-app-container">
        <div className="tj-chat-panel">
          <header className="tj-header">
            <div className="logo">TRADING_AI</div>
            <div className="tj-stats-badge">{busy ? 'THINKING…' : 'SESSION_ACTIVE'}</div>
          </header>
          <div className="tj-chat-history">
            {messages.map((msg, i) => (
              <div key={i} className={`tj-message tj-${msg.role}-msg`}>
                {msg.text}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
          <div className="tj-chat-input-area">
            <textarea
              id="tj-user-input"
              className="tj-textarea"
              rows={3}
              placeholder="e.g. Bought NVDA on 12/3, breakout at $138.50, stop $134, target $148, 2% size, execution 4/5, calm. Won at $146.20."
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        </div>

        <div className="tj-log-panel">
          <header className="tj-header">
            <div>TRADE_LOG</div>
            <div className="tj-stats-badge">
              COUNT: <span>{trades.length}</span>
            </div>
          </header>
          <div className="tj-trade-log">
            {trades.map((t, i) => {
              const isWin = t.result === 'Win'
              const color = isWin
                ? 'var(--tj-green)'
                : t.result === 'Loss'
                  ? 'var(--tj-red)'
                  : 'var(--tj-text-muted)'
              const rWidth = Math.min(Math.abs(Number(t.actual_r) || 0) * 20, 100)
              return (
                <div key={`${t.ticker}-${i}`} className="tj-trade-card">
                  <div className="tj-card-header">
                    <div>
                      <span className="tj-ticker">{t.ticker || '??'}</span>
                      <span
                        className={`tj-badge ${t.direction === 'Long' ? 'tj-badge-long' : 'tj-badge-short'}`}
                      >
                        {t.direction}
                      </span>
                      <span className={`tj-badge ${isWin ? 'tj-badge-win' : 'tj-badge-loss'}`}>
                        {t.result}
                      </span>
                    </div>
                    <span className="tj-stats-badge">{t.date ?? ''}</span>
                  </div>
                  <div className="tj-grid">
                    <div>
                      <span className="tj-label">SETUP</span>
                      {t.setup_type}
                    </div>
                    <div>
                      <span className="tj-label">ENTRY</span>${t.entry_price ?? 0}
                    </div>
                    <div>
                      <span className="tj-label">R-ENTRY</span>
                      <span className="tj-value-amber">{t.r_multiple_entry ?? 0}R</span>
                    </div>
                    <div>
                      <span className="tj-label">STOP</span>${t.stop_price ?? 0}
                    </div>
                    <div>
                      <span className="tj-label">TARGET</span>${t.target_price ?? 0}
                    </div>
                    <div>
                      <span className="tj-label">ACTUAL R</span>
                      <span style={{ color }}>{t.actual_r ?? 0}R</span>
                    </div>
                  </div>
                  <div className="tj-r-bar">
                    <div className="tj-r-fill" style={{ width: `${rWidth}%`, background: color }} />
                  </div>
                  <div style={{ fontSize: '0.75rem', marginBottom: '10px' }}>
                    <span className="tj-label">EMOTION</span>
                    {t.emotional_state} |<span className="tj-execution-dots"> {rDots(t.execution_quality)}</span>
                  </div>
                  <div className="tj-notes">
                    <p style={{ marginBottom: 5 }}>
                      <strong style={{ color: 'var(--tj-green)' }}>+</strong> {t.did_right || '...'}
                    </p>
                    <p>
                      <strong style={{ color: 'var(--tj-red)' }}>Δ</strong> {t.would_change || '...'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="tj-controls">
            <button type="button" className="tj-btn" disabled={busy} onClick={() => void requestReview()}>
              REQUEST REVIEW
            </button>
            <button type="button" className="tj-btn tj-btn-clear" onClick={clearAll}>
              CLEAR ALL
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
