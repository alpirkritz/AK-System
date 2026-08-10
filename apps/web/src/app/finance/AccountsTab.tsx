'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { BankConnectionModal, PROVIDER_LABELS } from '@/components/Modals/BankConnectionModal'
import { SummaryCard } from './SummaryCard'

function fmt(n: number, currency = 'ILS'): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

/** Mask account number: show only last 4 characters */
function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber
  return '•••• ' + accountNumber.slice(-4)
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  connected: { label: 'מחובר', color: '#34d399' },
  pending: { label: 'ממתין לסנכרון', color: '#647399' },
  error: { label: 'שגיאה', color: '#fb7185' },
  disabled: { label: 'מושבת', color: '#647399' },
  awaiting_otp: { label: 'ממתין לקוד אימות', color: '#fbbf24' },
}

export default function AccountsTab() {
  const [modalOpen, setModalOpen] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [otpByConnection, setOtpByConnection] = useState<Record<string, string>>({})

  const utils = trpc.useUtils()
  const { data: snapshot, isLoading: snapshotLoading } = trpc.finance.getAccountsSnapshot.useQuery()
  const { data: connections = [], isLoading: connectionsLoading } =
    trpc.finance.bankConnections.list.useQuery(undefined, {
      // TanStack Query v4: refetchInterval fn is (data, query) — not (query) like v5.
      refetchInterval: (data) => {
        if (syncingId) return 2000
        if (data?.some((c) => c.status === 'awaiting_otp')) return 2000
        return false
      },
    })
  const { data: crypto } = trpc.finance.bankConnections.cryptoConfigured.useQuery()

  const invalidateAll = () => {
    utils.finance.bankConnections.list.invalidate()
    utils.finance.getAccountsSnapshot.invalidate()
    utils.finance.listTransactions.invalidate()
    utils.finance.getSummary.invalidate()
  }

  const syncMutation = trpc.finance.bankConnections.sync.useMutation({
    onSuccess: (res) => {
      setSyncingId(null)
      setSyncMessage(
        res.success
          ? `סונכרנו ${res.accountsSynced} חשבונות — ${res.transactionsInserted} תנועות חדשות`
          : `שגיאה: ${res.error ?? 'סנכרון נכשל'}`
      )
      invalidateAll()
    },
    onError: (err) => {
      setSyncingId(null)
      setSyncMessage(`שגיאה: ${err.message}`)
      invalidateAll()
    },
  })

  const otpMutation = trpc.finance.bankConnections.submitOtp.useMutation({
    onSuccess: () => {
      setSyncMessage('הקוד נשלח — ממשיכים בסנכרון…')
      invalidateAll()
    },
    onError: (err) => {
      setSyncMessage(`שגיאה: ${err.message}`)
    },
  })

  const deleteMutation = trpc.finance.bankConnections.delete.useMutation({
    onSuccess: invalidateAll,
  })

  const handleSync = (id: string) => {
    setSyncingId(id)
    setSyncMessage(null)
    syncMutation.mutate({ id })
  }

  const handleSubmitOtp = (id: string) => {
    const code = (otpByConnection[id] ?? '').trim()
    if (code.length < 4) {
      setSyncMessage('שגיאה: הזן קוד אימות בן 4 ספרות לפחות')
      return
    }
    otpMutation.mutate({ id, code })
  }

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`למחוק את החיבור "${name}"? תנועות שכבר יובאו יישארו בתזרים.`)) return
    deleteMutation.mutate({ id })
  }

  if (connectionsLoading || snapshotLoading) {
    return <div className="text-[#5a688c] text-sm">טוען...</div>
  }

  return (
    <div>
      {/* Snapshot summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon="🏦"
          label="יתרה בבנקים"
          value={fmt(snapshot?.totalBankBalance ?? 0)}
          color={(snapshot?.totalBankBalance ?? 0) >= 0 ? '#34d399' : '#fb7185'}
        />
        <SummaryCard
          icon="💳"
          label="חיובי אשראי"
          value={fmt(Math.abs(snapshot?.totalCreditCardBalance ?? 0))}
          color="#fb7185"
        />
        <SummaryCard
          icon="🔗"
          label="חשבונות מחוברים"
          value={String(snapshot?.connectedCount ?? 0)}
          sub={`${connections.length} חיבורים מוגדרים`}
        />
        <SummaryCard
          icon="🕐"
          label="סנכרון אחרון"
          value={fmtDateTime(snapshot?.lastSyncAt ?? null)}
        />
      </div>

      {/* Encryption key warning */}
      {crypto && !crypto.configured && (
        <div
          className="mb-5 text-xs px-3 py-2 rounded-lg"
          style={{ background: '#fb718511', color: '#fb7185', border: '1px solid #fb718533' }}
        >
          מפתח ההצפנה לא מוגדר — הוסף BANK_CREDENTIALS_ENCRYPTION_KEY ל-.env.local
          (צור עם: openssl rand -base64 32)
        </div>
      )}

      {/* Header + add */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-[#7a89ab] uppercase tracking-wider">
          חיבורים ({connections.length})
        </h2>
        <button className="btn btn-primary text-sm" onClick={() => setModalOpen(true)}>
          + הוסף חשבון
        </button>
      </div>

      {syncMessage && (
        <div
          className="mb-4 text-xs px-3 py-2 rounded-lg"
          style={{
            background: syncMessage.startsWith('שגיאה') ? '#fb718511' : '#34d39911',
            color: syncMessage.startsWith('שגיאה') ? '#fb7185' : '#34d399',
            border: `1px solid ${syncMessage.startsWith('שגיאה') ? '#fb718533' : '#34d39933'}`,
          }}
        >
          {syncMessage}
        </div>
      )}

      {/* Connections */}
      {connections.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🏦</div>
          <div className="text-[#5a688c] text-sm">אין חשבונות מחוברים עדיין</div>
          <div className="text-xs text-[#4d659c] mt-1">
            לחץ על "+ הוסף חשבון" כדי לחבר בנק או כרטיס אשראי
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {connections.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.pending
            return (
              <div key={c.id} className="card">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl">
                      {c.provider === 'hapoalim' || c.provider === 'otsarHahayal' ? '🏦' : '💳'}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.displayName}</div>
                      <div className="text-xs text-[#647399]">
                        {PROVIDER_LABELS[c.provider as keyof typeof PROVIDER_LABELS] ?? c.provider}
                        {' · '}
                        סנכרון אחרון: {fmtDateTime(c.lastSyncAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="pill text-xs font-semibold"
                      style={{ color: meta.color, borderColor: `${meta.color}44` }}
                    >
                      {meta.label}
                    </span>
                    <button
                      className="btn btn-ghost text-xs"
                      onClick={() => handleSync(c.id)}
                      disabled={syncingId === c.id || c.status === 'awaiting_otp'}
                    >
                      {syncingId === c.id ? '⏳ מסנכרן...' : '🔄 סנכרן עכשיו'}
                    </button>
                    <button
                      className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                      onClick={() => handleDelete(c.id, c.displayName)}
                    >
                      מחק
                    </button>
                  </div>
                </div>

                {c.status === 'awaiting_otp' && (
                  <div
                    className="mt-3 px-3 py-3 rounded-lg"
                    style={{ background: '#fbbf2411', border: '1px solid #fbbf2433' }}
                  >
                    <div className="text-sm font-semibold text-[#fbbf24] mb-1">נדרש קוד אימות</div>
                    <div className="text-xs text-[#7a89ab] mb-3">
                      הזן את הקוד שקיבלת מהבנק (SMS). אחרי אימות מוצלח המכשיר יישמר לסנכרונים הבאים.
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="input text-sm max-w-[10rem]"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="קוד"
                        value={otpByConnection[c.id] ?? ''}
                        onChange={(e) =>
                          setOtpByConnection((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSubmitOtp(c.id)
                        }}
                      />
                      <button
                        className="btn btn-primary text-xs"
                        disabled={otpMutation.isPending}
                        onClick={() => handleSubmitOtp(c.id)}
                      >
                        {otpMutation.isPending ? 'שולח...' : 'שלח קוד'}
                      </button>
                    </div>
                  </div>
                )}

                {c.status === 'error' && c.lastError && (
                  <div className="mt-3 text-xs text-[#fb7185] px-3 py-2 rounded-lg" style={{ background: '#fb718511', border: '1px solid #fb718533' }}>
                    {c.lastError}
                    {c.lastErrorType ? ` (${c.lastErrorType})` : ''}
                  </div>
                )}

                {c.accounts.length > 0 && (
                  <div className="mt-3 border-t border-[#1d2b46] pt-3 flex flex-col gap-2">
                    {c.accounts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-sm">
                        <span className="text-[#7a89ab]" dir="ltr">{maskAccount(a.accountNumber)}</span>
                        <span
                          className="font-semibold"
                          style={{
                            color:
                              a.balance == null
                                ? '#647399'
                                : parseFloat(a.balance) >= 0
                                  ? '#34d399'
                                  : '#fb7185',
                          }}
                        >
                          {a.balance != null ? fmt(parseFloat(a.balance), a.balanceCurrency) : 'אין יתרה'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <BankConnectionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
