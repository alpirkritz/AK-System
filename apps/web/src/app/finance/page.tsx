'use client'

import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { CategorySelect } from './components/CategorySelect'
import { SummaryCard } from './SummaryCard'
import { fmt, fmtDate } from './lib/format'

import InsightsTab from './InsightsTab'

const VatTab = lazy(() => import('./VatTab'))
const TradingJournalTab = lazy(() => import('./TradingJournalTab'))
const AccountsTab = lazy(() => import('./AccountsTab'))
const DocumentsTab = lazy(() => import('./DocumentsTab'))

const TABS = [
  'insights',
  'accounts',
  'portfolio',
  'journal',
  'cashflow',
  'import',
  'documents',
  'vat',
] as const
type Tab = (typeof TABS)[number]

/** useSearchParams needs a Suspense boundary above it, same as the settings page. */
export default function FinancePage() {
  return (
    <Suspense fallback={<div className="text-[#5a688c] text-sm p-6">טוען...</div>}>
      <FinancePageContent />
    </Suspense>
  )
}

function FinancePageContent() {
  // Tab lives in the URL so a view is linkable and survives a refresh, which the previous
  // local-state version did not.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : 'insights'
  const setTab = useCallback(
    (next: Tab) => {
      router.replace(`${pathname}?tab=${next}`, { scroll: false })
    },
    [router, pathname]
  )
  const [symbolFilter, setSymbolFilter] = useState('')
  const [dirFilter, setDirFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [notionImporting, setNotionImporting] = useState(false)
  const [notionResult, setNotionResult] = useState<string | null>(null)
  const [showDiag, setShowDiag] = useState(false)
  const [debugQuery, setDebugQuery] = useState('interactivebrokers')
  const [runDebug, setRunDebug] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Manual entry form state
  const [manualForm, setManualForm] = useState({
    amount: '',
    currency: 'ILS',
    direction: 'expense' as 'income' | 'expense',
    category: 'אחר',
    description: '',
    transactionDate: new Date().toISOString().slice(0, 10),
  })
  const [manualSubmitting, setManualSubmitting] = useState(false)

  const utils = trpc.useUtils()

  const { data: ibkrEmails, isLoading: diagLoading } = trpc.finance.listIBKREmails.useQuery(
    { max: 50 },
    { enabled: showDiag }
  )
  const { data: debugData, isLoading: debugLoading } = trpc.finance.gmailDebug.useQuery(
    { query: debugQuery },
    { enabled: runDebug }
  )
  const { data: summary, isLoading: summaryLoading } = trpc.finance.getSummary.useQuery()
  const { data: trades = [], isLoading: tradesLoading } = trpc.finance.listTrades.useQuery({
    symbol: symbolFilter || undefined,
    limit: 300,
  })
  const {
    data: transactions = [],
    isLoading: txnLoading,
    isError: txnError,
    refetch: refetchTransactions,
  } = trpc.finance.listTransactions.useQuery(
    {
      direction: dirFilter === 'all' ? undefined : dirFilter,
      limit: 300,
    },
    { enabled: tab === 'cashflow' }
  )

  const syncMutation = trpc.finance.syncIBKREmails.useMutation({
    onSuccess: (res) => {
      setSyncResult(`נסרקו ${res.total} מיילים — יובאו ${res.inserted} עסקאות חדשות (${res.skipped} כפולות)`)
      utils.finance.getSummary.invalidate()
      utils.finance.listTrades.invalidate()
      utils.finance.getTradingJournal.invalidate()
      utils.finance.getSymbolRanking.invalidate()
      setSyncing(false)
    },
    onError: (err) => {
      setSyncResult(`שגיאה: ${err.message}`)
      setSyncing(false)
    },
  })

  const { data: notionConfig } = trpc.finance.notionIbkrConfigured.useQuery()

  const notionImportMutation = trpc.finance.importFromNotion.useMutation({
    onSuccess: (res) => {
      const errNote = res.failed > 0 ? ` — ${res.failed} דולגו (שדות חסרים)` : ''
      setNotionResult(`יובאו ${res.inserted} עסקאות מ-Notion (${res.skipped} כפולות)${errNote}`)
      utils.finance.getSummary.invalidate()
      utils.finance.listTrades.invalidate()
      utils.finance.getTradingJournal.invalidate()
      utils.finance.getSymbolRanking.invalidate()
      setNotionImporting(false)
    },
    onError: (err) => {
      setNotionResult(`שגיאה: ${err.message}`)
      setNotionImporting(false)
    },
  })

  const importCSVMutation = trpc.finance.importCSV.useMutation({
    onSuccess: (res) => {
      setImportResult(
        `זוהה פורמט: ${res.detectedFormat} — יובאו ${res.inserted} רשומות (${res.skipped} דולגו)`
      )
      utils.finance.getSummary.invalidate()
      utils.finance.listTransactions.invalidate()
    },
    onError: (err) => setImportResult(`שגיאה: ${err.message}`),
  })

  const importPDFMutation = trpc.finance.importPDF.useMutation({
    onSuccess: (res) => {
      setImportResult(
        `זוהה פורמט: ${res.detectedFormat} — יובאו ${res.inserted} רשומות (${res.skipped} דולגו)`
      )
      utils.finance.getSummary.invalidate()
      utils.finance.listTransactions.invalidate()
    },
    onError: (err) => setImportResult(`שגיאה: ${err.message}`),
  })

  const createTxnMutation = trpc.finance.createTransaction.useMutation({
    onSuccess: () => {
      setManualSubmitting(false)
      setManualForm({
        amount: '', currency: 'ILS', direction: 'expense',
        category: 'אחר', description: '',
        transactionDate: new Date().toISOString().slice(0, 10),
      })
      utils.finance.getSummary.invalidate()
      utils.finance.listTransactions.invalidate()
    },
    onError: () => setManualSubmitting(false),
  })

  const deleteTradeMutation = trpc.finance.deleteTrade.useMutation({
    onSuccess: () => {
      utils.finance.listTrades.invalidate()
      utils.finance.getSummary.invalidate()
    },
  })

  const deleteTxnMutation = trpc.finance.deleteTransaction.useMutation({
    onSuccess: () => {
      utils.finance.listTransactions.invalidate()
      utils.finance.getSummary.invalidate()
    },
  })

  const setTxnCategoryMutation = trpc.finance.setTransactionCategory.useMutation({
    onSuccess: () => {
      utils.finance.listTransactions.invalidate()
      utils.finance.getSummary.invalidate()
      utils.finance.analytics.invalidate()
    },
  })

  const handleSync = () => {
    setSyncing(true)
    setSyncResult(null)
    syncMutation.mutate({ maxEmails: 100 })
  }

  const handleNotionImport = () => {
    if (!window.confirm('לייבא את היסטוריית העסקאות מ-Notion? כפילויות ידולגו אוטומטית.')) return
    setNotionImporting(true)
    setNotionResult(null)
    notionImportMutation.mutate({ dryRun: false })
  }

  const handleImportFile = useCallback((file: File) => {
    if (!file) return
    setImportResult(null)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer
        if (buffer) {
          const bytes = new Uint8Array(buffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          const base64 = btoa(binary)
          importPDFMutation.mutate({ pdfBase64: base64 })
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content) importCSVMutation.mutate({ csvContent: content })
      }
      reader.readAsText(file, 'utf-8')
    }
  }, [importCSVMutation, importPDFMutation])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleImportFile(file)
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(manualForm.amount)
    if (!amount || !manualForm.description) return
    setManualSubmitting(true)
    createTxnMutation.mutate({
      amount,
      currency: manualForm.currency,
      direction: manualForm.direction,
      category: manualForm.category,
      description: manualForm.description,
      transactionDate: manualForm.transactionDate,
    })
  }

  const symbolGroups = useMemo(() =>
    trades.reduce<Record<string, typeof trades>>((acc, t) => {
      if (!acc[t.symbol]) acc[t.symbol] = []
      acc[t.symbol].push(t)
      return acc
    }, {}),
  [trades])

  const openPositions = summary?.openPositions ?? []

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-bold tracking-tight">פיננסים</h1>
        <div className="text-xs text-[#5a688c]">IBKR · ניהול תזרים</div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon="💼"
          label="פוזיציות פתוחות"
          value={summaryLoading ? '...' : String(openPositions.length)}
          sub={`${summary?.totalTradesAllTime ?? 0} עסקאות סה"כ`}
        />
        <SummaryCard
          icon="📈"
          label="עסקאות החודש"
          value={summaryLoading ? '...' : String(summary?.tradesThisMonth ?? 0)}
          sub={summary?.realizedPnl !== undefined
            ? `P&L ממומש: ${fmt(summary.realizedPnl, 'USD')}`
            : undefined}
          color={
            summary?.realizedPnl !== undefined && summary.realizedPnl >= 0
              ? '#34d399'
              : '#fb7185'
          }
        />
        <SummaryCard
          icon="💸"
          label="הוצאות החודש"
          value={summaryLoading ? '...' : fmt(summary?.monthlyExpenses ?? 0)}
          sub="ללא העברות וחיובי אשראי"
          color="#fb7185"
        />
        <SummaryCard
          icon="💰"
          label="הכנסות החודש"
          value={summaryLoading ? '...' : fmt(summary?.monthlyIncome ?? 0)}
          sub={
            summary?.monthlyNet !== undefined
              ? `נטו: ${fmt(summary.monthlyNet)} · ללא העברות פנימיות`
              : 'ללא העברות פנימיות'
          }
          color="#34d399"
        />
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 border-b border-[#1d2b46]">
        {([
          ['insights', 'תזרים ותובנות', '📈'],
          ['accounts', 'חשבונות', '🏦'],
          ['portfolio', 'פורטפוליו', '📊'],
          ['journal', 'יומן מסחר', '📓'],
          ['cashflow', 'תנועות', '🔄'],
          ['import', 'ייבוא', '⬆️'],
          ['documents', 'מסמכים', '🧾'],
          ['vat', 'דיווח מע"מ', '📋'],
        ] as [Tab, string, string][]).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="btn btn-ghost text-sm px-4 py-2 rounded-b-none"
            style={{
              borderBottom: tab === id ? '2px solid #2dd4bf' : '2px solid transparent',
              color: tab === id ? '#2dd4bf' : '#647399',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ── Insights Tab ──────────────────────────────────────────── */}
      {tab === 'insights' && <InsightsTab />}

      {/* ── Accounts Tab ──────────────────────────────────────────── */}
      {tab === 'accounts' && (
        <Suspense fallback={<div className="text-[#5a688c] text-sm">טוען...</div>}>
          <AccountsTab />
        </Suspense>
      )}

      {/* ── Portfolio Tab ─────────────────────────────────────────── */}
      {tab === 'portfolio' && (
        <div>
          {/* Filter */}
          <div className="flex gap-3 mb-5">
            <input
              className="input"
              style={{ maxWidth: 200 }}
              placeholder="סינון לפי סימבול..."
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            />
          </div>

          {/* Open Positions */}
          {openPositions.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-[#7a89ab] mb-3 uppercase tracking-wider">
                פוזיציות פתוחות
              </h2>
              <div className="card p-0 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-[#29395d]">
                      {['סימבול', 'כמות', 'עלות ממוצעת', 'עלות כוללת', 'קנייה סה"כ', 'מכירה סה"כ'].map((h) => (
                        <th key={h} className="text-right px-4 py-3 text-[11px] font-medium text-[#5a688c] uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((pos) => (
                      <tr key={pos.symbol} className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors">
                        <td className="px-4 py-3 font-bold text-[#2dd4bf]">{pos.symbol}</td>
                        <td className="px-4 py-3">{pos.sharesOwned.toLocaleString()}</td>
                        <td className="px-4 py-3">${pos.avgCost.toFixed(2)}</td>
                        <td className="px-4 py-3">{fmt(pos.sharesOwned * pos.avgCost, 'USD')}</td>
                        <td className="px-4 py-3 text-[#fb7185]">{fmt(pos.totalBought, 'USD')}</td>
                        <td className="px-4 py-3 text-[#34d399]">{fmt(pos.totalSold, 'USD')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* All Trades */}
          <div>
            <h2 className="text-sm font-semibold text-[#7a89ab] mb-3 uppercase tracking-wider">
              היסטוריית עסקאות ({trades.length})
            </h2>
            {tradesLoading ? (
              <div className="text-[#5a688c] text-sm">טוען...</div>
            ) : trades.length === 0 ? (
              <div className="card text-center py-12">
                <div className="text-4xl mb-3">📭</div>
                <div className="text-[#5a688c] text-sm">אין עסקאות עדיין</div>
                <div className="text-xs text-[#4d659c] mt-1">לחץ על "ייבוא" כדי לסנכרן מיילי IBKR</div>
              </div>
            ) : (
              <div className="card p-0 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-[#29395d]">
                      {['תאריך', 'סימבול', 'פעולה', 'כמות', 'מחיר', 'עמלה', 'מ\''].map((h) => (
                        <th key={h} className="text-right px-4 py-3 text-[11px] font-medium text-[#5a688c] uppercase">
                          {h}
                        </th>
                      ))}
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors group">
                        <td className="px-4 py-3 text-[#647399]">{fmtDate(t.tradeDate)}</td>
                        <td className="px-4 py-3 font-bold text-[#2dd4bf]">{t.symbol}</td>
                        <td className="px-4 py-3">
                          <span
                            className="pill text-xs font-semibold"
                            style={{
                              color: t.direction === 'buy' ? '#34d399' : '#fb7185',
                              borderColor: t.direction === 'buy' ? '#34d39944' : '#fb718544',
                            }}
                          >
                            {t.direction === 'buy' ? '▲ קנייה' : '▼ מכירה'}
                          </span>
                        </td>
                        <td className="px-4 py-3">{parseFloat(t.quantity).toLocaleString()}</td>
                        <td className="px-4 py-3">${parseFloat(t.price).toFixed(2)}</td>
                        <td className="px-4 py-3 text-[#647399]">
                          {t.commission ? `$${parseFloat(t.commission).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-[#5a688c] text-xs">{t.currency}</td>
                        <td className="px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                            onClick={() => deleteTradeMutation.mutate({ id: t.id })}
                          >
                            מחק
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Trading Journal Tab ───────────────────────────────────── */}
      {tab === 'journal' && (
        <Suspense fallback={<div className="text-[#5a688c] text-sm">טוען...</div>}>
          <TradingJournalTab />
        </Suspense>
      )}

      {/* ── Cash Flow Tab ─────────────────────────────────────────── */}
      {tab === 'cashflow' && (
        <div>
          {/* Filter */}
          <div className="flex gap-2 mb-5">
            {(['all', 'expense', 'income'] as const).map((d) => (
              <button
                key={d}
                className="btn btn-ghost text-xs"
                style={{
                  color: dirFilter === d ? '#2dd4bf' : '#647399',
                  borderColor: dirFilter === d ? '#2dd4bf44' : '#2f4368',
                }}
                onClick={() => setDirFilter(d)}
              >
                {d === 'all' ? 'הכל' : d === 'expense' ? '💸 הוצאות' : '💰 הכנסות'}
              </button>
            ))}
          </div>

          {txnError ? (
            <div className="card max-w-xl">
              <div className="text-sm font-semibold text-[#fb7185] mb-2">לא הצלחתי לטעון את התנועות</div>
              <p className="text-xs text-[#97a4c2] mb-3">
                ייתכן שיש בעיית חיבור לשרת או שה-session פג. נסה לרענן.
              </p>
              <button className="btn btn-ghost text-xs" onClick={() => refetchTransactions()}>
                נסה שוב
              </button>
            </div>
          ) : txnLoading ? (
            <div className="text-[#5a688c] text-sm">טוען...</div>
          ) : transactions.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">📂</div>
              <div className="text-[#5a688c] text-sm">אין רשומות עדיין</div>
              <div className="text-xs text-[#4d659c] mt-1">ייבא CSV מהבנק או הוסף ידנית בלשונית "ייבוא"</div>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-[#29395d]">
                    {['תאריך', 'תיאור', 'קטגוריה', 'סכום', 'מ\'', 'מקור'].map((h) => (
                      <th key={h} className="text-right px-4 py-3 text-[11px] font-medium text-[#5a688c] uppercase">
                        {h}
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors group">
                      <td className="px-4 py-3 text-[#647399] whitespace-nowrap">{fmtDate(t.transactionDate)}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate">{t.description}</td>
                      <td className="px-4 py-3">
                        <CategorySelect
                          className="input text-xs py-1 min-w-[7rem]"
                          value={t.category ?? 'אחר'}
                          disabled={setTxnCategoryMutation.isPending}
                          aria-label="שנה קטגוריה"
                          onChange={(category) =>
                            setTxnCategoryMutation.mutate({
                              id: t.id,
                              category,
                              applyToSimilar: false,
                            })
                          }
                        />
                      </td>
                      <td
                        className="px-4 py-3 font-semibold"
                        style={{ color: t.direction === 'income' ? '#34d399' : '#fb7185' }}
                      >
                        {t.direction === 'income' ? '+' : '-'}
                        {fmt(parseFloat(t.amount), t.currency)}
                      </td>
                      <td className="px-4 py-3 text-[#5a688c] text-xs">{t.currency}</td>
                      <td className="px-4 py-3">
                        <span className="pill text-xs">
                          {t.source === 'manual' ? '✏️ ידני' : t.source === 'bank_scrape' ? '🏦 בנק' : '📄 CSV'}
                        </span>
                      </td>
                      <td className="px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                          onClick={() => deleteTxnMutation.mutate({ id: t.id })}
                        >
                          מחק
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Import Tab ────────────────────────────────────────────── */}
      {tab === 'import' && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Gmail + CSV */}
          <div className="flex flex-col gap-5">
            {/* Gmail Sync */}
            <div className="card">
              <h2 className="font-semibold mb-1">סנכרון מ-Gmail (IBKR)</h2>
              <p className="text-xs text-[#5a688c] mb-4">
                סורק את ה-Gmail שלך לאיתור מיילי אישור עסקאות מ-Interactive Brokers ומייבא אותם אוטומטית.
                הרשאה נדרשת: <code className="bg-[#1d2b46] px-1 rounded text-[#2dd4bf]">gmail.readonly</code>
              </p>
              <button
                className="btn btn-primary w-full"
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? '⏳ סורק מיילים...' : '📧 סנכרן עסקאות IBKR'}
              </button>
              {syncResult && (
                <div
                  className="mt-3 text-xs px-3 py-2 rounded-lg"
                  style={{
                    background: syncResult.startsWith('שגיאה') ? '#fb718511' : '#34d39911',
                    color: syncResult.startsWith('שגיאה') ? '#fb7185' : '#34d399',
                    border: `1px solid ${syncResult.startsWith('שגיאה') ? '#fb718533' : '#34d39933'}`,
                  }}
                >
                  {syncResult}
                </div>
              )}

              {/* Diagnostics */}
              <div className="mt-4 border-t border-[#1d2b46] pt-4">
                <button
                  className="btn btn-ghost text-xs w-full"
                  onClick={() => { setShowDiag((v) => !v); setRunDebug(false) }}
                >
                  {showDiag ? '▲ הסתר אבחון' : '🔍 אבחון Gmail'}
                </button>

                {showDiag && (
                  <div className="mt-3 flex flex-col gap-3">

                    {/* Search test */}
                    <div>
                      <div className="text-xs text-[#647399] mb-2">חיפוש חופשי ב-Gmail:</div>
                      <div className="flex gap-2">
                        <input
                          className="input text-xs"
                          value={debugQuery}
                          onChange={(e) => { setDebugQuery(e.target.value); setRunDebug(false) }}
                          placeholder="מילת חיפוש..."
                        />
                        <button
                          className="btn btn-ghost text-xs flex-shrink-0"
                          onClick={() => setRunDebug(true)}
                        >
                          חפש
                        </button>
                      </div>
                      {runDebug && (
                        <div className="mt-2">
                          {debugLoading ? (
                            <div className="text-xs text-[#5a688c]">מחפש...</div>
                          ) : !debugData || debugData.length === 0 ? (
                            <div className="text-xs text-[#fb7185]">
                              לא נמצאו מיילים עם "{debugQuery}"
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {debugData.map((e) => (
                                <div
                                  key={e.id}
                                  className="text-xs rounded-lg p-3 flex flex-col gap-1"
                                  style={{ background: '#1d2b46', border: '1px solid #29395d' }}
                                >
                                  <div className="flex justify-between gap-2">
                                    <span className="font-semibold text-[#eef3fb] truncate">{e.subject || '(ללא כותרת)'}</span>
                                    <span className="text-[#5a688c] flex-shrink-0">{e.date ? new Date(e.date).toLocaleDateString('he-IL') : ''}</span>
                                  </div>
                                  <div className="text-[#7a89ab]">מאת: {e.from}</div>
                                  <div
                                    className="text-[#5a688c] mt-1 font-mono leading-relaxed whitespace-pre-wrap break-all"
                                    style={{ fontSize: 10 }}
                                  >
                                    {e.bodySnippet}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* IBKR-specific scan */}
                    <div className="border-t border-[#1d2b46] pt-3">
                      <button
                        className="btn btn-ghost text-xs w-full"
                        onClick={() => setShowDiag((v) => { if (!v) setRunDebug(false); return v })}
                      >
                        {diagLoading ? 'סורק מ-IBKR...' : 'סריקת IBKR ספציפית'}
                      </button>
                      {ibkrEmails && ibkrEmails.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1">
                          <div className="text-xs text-[#647399] mb-1">נמצאו {ibkrEmails.length} מיילים מ-IBKR:</div>
                          {ibkrEmails.map((e) => (
                            <div
                              key={e.id}
                              className="text-xs px-3 py-2 rounded-lg flex justify-between gap-2"
                              style={{ background: '#1d2b46', border: '1px solid #29395d' }}
                            >
                              <div className="flex flex-col gap-0.5 overflow-hidden">
                                <span className="text-[#eef3fb] truncate">{e.subject || '(ללא כותרת)'}</span>
                                <span className="text-[#5a688c]">{e.from}</span>
                              </div>
                              <span
                                className="font-semibold flex-shrink-0"
                                style={{ color: e.tradesParsed > 0 ? '#34d399' : '#647399' }}
                              >
                                {e.tradesParsed > 0 ? `✓ ${e.tradesParsed}` : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Notion historical import */}
            <div className="card">
              <h2 className="font-semibold mb-1">ייבוא היסטוריה מ-Notion</h2>
              <p className="text-xs text-[#5a688c] mb-4">
                ייבוא חד-פעמי של היסטוריית העסקאות מבסיס הנתונים 📈 IBKR Transactions ב-Notion.
                כפילויות מדולגות אוטומטית — אפשר להריץ שוב בבטחה.
              </p>
              <button
                className="btn btn-primary w-full"
                onClick={handleNotionImport}
                disabled={notionImporting || notionConfig?.configured === false}
              >
                {notionImporting ? '⏳ מייבא מ-Notion...' : '📥 ייבא היסטוריה מ-Notion'}
              </button>
              {notionConfig?.configured === false && (
                <div className="mt-3 text-xs text-[#7a89ab]">
                  לא הוגדר בסיס נתונים של IBKR ב-Notion — הוסף אותו ל-<code className="bg-[#1d2b46] px-1 rounded text-[#2dd4bf]">NOTION_ACCOUNTS</code>
                </div>
              )}
              {notionResult && (
                <div
                  className="mt-3 text-xs px-3 py-2 rounded-lg"
                  style={{
                    background: notionResult.startsWith('שגיאה') ? '#fb718511' : '#34d39911',
                    color: notionResult.startsWith('שגיאה') ? '#fb7185' : '#34d399',
                    border: `1px solid ${notionResult.startsWith('שגיאה') ? '#fb718533' : '#34d39933'}`,
                  }}
                >
                  {notionResult}
                </div>
              )}
            </div>

            {/* CSV Upload */}
            <div className="card">
              <h2 className="font-semibold mb-1">ייבוא CSV או PDF מהבנק / כרטיס אשראי</h2>
              <p className="text-xs text-[#5a688c] mb-4">
                מזהה אוטומטית: בנק הפועלים, לאומי, דיסקונט, Max, Isracard, ויזה כאל (Cal).
                ייצא קובץ CSV/Excel מהאתר, או העלה דוח PDF (למשל ויזה כאל).
              </p>
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors"
                style={{
                  borderColor: isDragging ? '#2dd4bf' : '#2f4368',
                  background: isDragging ? '#2dd4bf08' : 'transparent',
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-3xl mb-2">📄</div>
                <div className="text-sm text-[#7a89ab]">גרור לכאן קובץ CSV או PDF</div>
                <div className="text-xs text-[#5a688c] mt-1">או לחץ לבחירת קובץ</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,.txt,.pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImportFile(file)
                    e.target.value = ''
                  }}
                />
              </div>
              {importResult && (
                <div
                  className="mt-3 text-xs px-3 py-2 rounded-lg"
                  style={{
                    background: importResult.startsWith('שגיאה') ? '#fb718511' : '#34d39911',
                    color: importResult.startsWith('שגיאה') ? '#fb7185' : '#34d399',
                    border: `1px solid ${importResult.startsWith('שגיאה') ? '#fb718533' : '#34d39933'}`,
                  }}
                >
                  {importResult}
                </div>
              )}
            </div>
          </div>

          {/* Right: Manual Entry */}
          <div className="card">
            <h2 className="font-semibold mb-4">הוספה ידנית</h2>
            <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">סכום</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={manualForm.amount}
                    onChange={(e) => setManualForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="label">מטבע</label>
                  <select
                    className="select"
                    value={manualForm.currency}
                    onChange={(e) => setManualForm((f) => ({ ...f, currency: e.target.value }))}
                  >
                    {['ILS', 'USD', 'EUR', 'GBP'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">סוג</label>
                <div className="flex gap-2">
                  {(['expense', 'income'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="btn btn-ghost flex-1 text-sm"
                      style={{
                        color: manualForm.direction === d
                          ? (d === 'expense' ? '#fb7185' : '#34d399')
                          : '#647399',
                        borderColor: manualForm.direction === d
                          ? (d === 'expense' ? '#fb718544' : '#34d39944')
                          : '#2f4368',
                      }}
                      onClick={() => setManualForm((f) => ({ ...f, direction: d }))}
                    >
                      {d === 'expense' ? '💸 הוצאה' : '💰 הכנסה'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">קטגוריה</label>
                <CategorySelect
                  className="select"
                  value={manualForm.category}
                  kind={manualForm.direction}
                  onChange={(category) => setManualForm((f) => ({ ...f, category }))}
                />
              </div>

              <div>
                <label className="label">תיאור</label>
                <input
                  className="input"
                  placeholder="לדוגמה: קניות בסופר"
                  value={manualForm.description}
                  onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="label">תאריך</label>
                <input
                  className="input"
                  type="date"
                  value={manualForm.transactionDate}
                  onChange={(e) => setManualForm((f) => ({ ...f, transactionDate: e.target.value }))}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary mt-1"
                disabled={manualSubmitting}
              >
                {manualSubmitting ? 'שומר...' : '+ הוסף רשומה'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Sales Documents Tab ───────────────────────────────────── */}
      {tab === 'documents' && (
        <Suspense fallback={<div className="text-[#5a688c] text-sm">טוען...</div>}>
          <DocumentsTab />
        </Suspense>
      )}

      {/* ── VAT Reporting Tab ─────────────────────────────────────── */}
      {tab === 'vat' && (
        <Suspense fallback={<div className="text-[#5a688c] text-sm">טוען...</div>}>
          <VatTab />
        </Suspense>
      )}
    </div>
  )
}
