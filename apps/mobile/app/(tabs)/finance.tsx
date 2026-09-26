import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { KpiCard } from '../components/KpiCard'
import { ListRow } from '../components/ListRow'
import { SectionHeader } from '../components/SectionHeader'
import { SegmentControl, type SegmentItem } from '../components/SegmentControl'
import { SimpleBars } from '../components/SimpleBars'
import { useAuth } from '../lib/auth'
import {
  fetchAccountsSnapshot,
  fetchFinanceCoverage,
  fetchFinanceInsights,
  fetchFinanceNarrative,
  fetchFinanceSummary,
  fetchFinanceTransactions,
  fetchTradingJournal,
  fetchVatPeriodSummary,
  setTransactionCategory,
} from '../lib/data'
import { colors } from '../lib/theme'

type SegmentKey = 'summary' | 'cashflow' | 'insights' | 'trading' | 'accounts' | 'vat'

const SEGMENTS: SegmentItem[] = [
  { key: 'summary', label: 'סיכום' },
  { key: 'cashflow', label: 'תזרים' },
  { key: 'insights', label: 'תובנות' },
  { key: 'trading', label: 'מסחר' },
  { key: 'accounts', label: 'חשבונות' },
  { key: 'vat', label: 'מע״מ' },
]

/** Common cash-flow categories (mirrors @ak-system/types — not imported in Metro). */
const COMMON_CATEGORIES = [
  'מזון',
  'אוכל בחוץ',
  'רכב',
  'ביגוד',
  'בריאות',
  'חשבונות',
  'מנויים',
  'שכירות',
  'משכורת',
  'הכנסה אחרת',
  'העברות',
  'כרטיס אשראי',
  'חיסכון והשקעות',
  'אחר',
]

type TxnRow = {
  id: string
  description?: string | null
  amount?: string | number | null
  direction?: string | null
  category?: string | null
  transactionDate?: string | null
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

function fmtMoney(v: unknown): string {
  const n = asNum(v)
  return `${Math.round(n).toLocaleString('he-IL')} ₪`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function currentVatPeriod(): { year: number; period: number } {
  const now = new Date()
  const month = now.getMonth() + 1
  return { year: now.getFullYear(), period: Math.ceil(month / 2) }
}

function recordField<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === 'object' && key in obj) return (obj as Record<string, T>)[key]
  return undefined
}

function insightLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const title = o.title ?? o.headline ?? o.label
      const body = o.body ?? o.message ?? o.detail
      if (title && body) return `${String(title)}: ${String(body)}`
      if (title) return String(title)
      if (body) return String(body)
      return JSON.stringify(item)
    }
    return String(item)
  })
}

export default function FinanceScreen() {
  const { token } = useAuth()
  const [segment, setSegment] = useState<SegmentKey>('summary')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [transactions, setTransactions] = useState<TxnRow[]>([])
  const [insightsRaw, setInsightsRaw] = useState<unknown>(null)
  const [narrativeRaw, setNarrativeRaw] = useState<unknown>(null)
  const [coverageRaw, setCoverageRaw] = useState<unknown>(null)
  const [journal, setJournal] = useState<Record<string, unknown> | null>(null)
  const [accountsRaw, setAccountsRaw] = useState<unknown>(null)
  const [vatRaw, setVatRaw] = useState<unknown>(null)

  const vatPeriod = useMemo(() => currentVatPeriod(), [])

  const loadSegment = useCallback(
    async (key: SegmentKey, mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        switch (key) {
          case 'summary':
            setSummary((await fetchFinanceSummary(token)) as Record<string, unknown>)
            break
          case 'cashflow':
            setTransactions((await fetchFinanceTransactions(token, 80)) as TxnRow[])
            break
          case 'insights': {
            const [ins, nar, cov] = await Promise.all([
              fetchFinanceInsights(token),
              fetchFinanceNarrative(token).catch(() => null),
              fetchFinanceCoverage(token),
            ])
            setInsightsRaw(ins)
            setNarrativeRaw(nar)
            setCoverageRaw(cov)
            break
          }
          case 'trading':
            setJournal((await fetchTradingJournal(token)) as Record<string, unknown>)
            break
          case 'accounts':
            setAccountsRaw(await fetchAccountsSnapshot(token))
            break
          case 'vat':
            setVatRaw(await fetchVatPeriodSummary(token, vatPeriod.year, vatPeriod.period))
            break
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, vatPeriod.period, vatPeriod.year],
  )

  useEffect(() => {
    void loadSegment(segment)
  }, [segment, loadSegment])

  const onRefresh = () => void loadSegment(segment, 'refresh')

  const pickCategory = (txn: TxnRow) => {
    if (!token) return
    const buttons = [
      ...COMMON_CATEGORIES.map((cat) => ({
        text: cat,
        onPress: () => void applyCategory(txn, cat, false),
      })),
      {
        text: 'החל על דומות',
        onPress: () => {
          Alert.alert('קטגוריה', 'בחר קטגוריה להחלה על תנועות דומות', [
            ...COMMON_CATEGORIES.slice(0, 8).map((cat) => ({
              text: cat,
              onPress: () => void applyCategory(txn, cat, true),
            })),
            { text: 'ביטול', style: 'cancel' as const },
          ])
        },
      },
      { text: 'ביטול', style: 'cancel' as const },
    ]
    Alert.alert('שינוי קטגוריה', txn.description ?? 'תנועה', buttons)
  }

  const applyCategory = async (txn: TxnRow, category: string, applyToSimilar: boolean) => {
    if (!token) return
    const prev = transactions
    setTransactions((rows) =>
      rows.map((r) => (r.id === txn.id ? { ...r, category } : r)),
    )
    try {
      await setTransactionCategory(token, { id: txn.id, category, applyToSimilar })
    } catch {
      setTransactions(prev)
      setError('עדכון קטגוריה נכשל')
    }
  }

  const summaryBars = useMemo(() => {
    if (!summary) return []
    return [
      {
        label: 'הכנסות',
        value: asNum(summary.monthlyIncome),
        color: colors.success,
      },
      {
        label: 'הוצאות',
        value: asNum(summary.monthlyExpenses),
        color: colors.coral,
      },
      {
        label: 'נטו',
        value: asNum(summary.monthlyNet),
        color: colors.accent,
      },
    ]
  }, [summary])

  const renderSummary = () => {
    if (!summary) return <EmptyState icon="💰" text="אין נתוני סיכום" compact />
    return (
      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.kpiRow}>
          <KpiCard value={fmtMoney(summary.monthlyIncome)} label="הכנסות החודש" color={colors.success} />
          <KpiCard value={fmtMoney(summary.monthlyExpenses)} label="הוצאות החודש" color={colors.coral} />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard value={fmtMoney(summary.monthlyNet)} label="נטו החודש" />
          <KpiCard value={asNum(summary.totalTransactions)} label="תנועות" color={colors.info} />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard value={asNum(summary.tradesThisMonth)} label="עסקאות החודש" />
          <KpiCard
            value={fmtMoney(summary.realizedPnl)}
            label="P&L ממומש"
            color={asNum(summary.realizedPnl) >= 0 ? colors.success : colors.coral}
          />
        </View>
        {summaryBars.length > 0 ? (
          <Card style={styles.block}>
            <SectionHeader title="מגמת החודש" style={styles.sectionInline} />
            <SimpleBars data={summaryBars} />
          </Card>
        ) : null}
        {Array.isArray(summary.openPositions) && summary.openPositions.length > 0 ? (
          <Card style={styles.block}>
            <SectionHeader title="פוזיציות פתוחות" style={styles.sectionInline} />
            {(summary.openPositions as Array<Record<string, unknown>>).slice(0, 5).map((p, i) => (
              <ListRow
                key={String(p.symbol ?? i)}
                label={String(p.symbol ?? '—')}
                value={`${asNum(p.sharesOwned)} יח׳`}
                subtitle={`ממוצע ${fmtMoney(p.avgCost)}`}
              />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    )
  }

  const renderCashflow = () => (
    <FlatList
      data={transactions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={transactions.length === 0 ? styles.flexGrow : styles.listPad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      ListEmptyComponent={<EmptyState icon="💳" text="אין תנועות להצגה" />}
      renderItem={({ item }) => {
        const expense = item.direction === 'expense'
        const amount = asNum(item.amount)
        return (
          <Pressable
            onPress={() => pickCategory(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.description ?? 'תנועה'} — שינוי קטגוריה`}
            style={({ pressed }) => [styles.txnRow, pressed && styles.pressed]}
          >
            <View style={styles.txnMain}>
              <Text style={styles.txnTitle} numberOfLines={1}>
                {item.description ?? 'ללא תיאור'}
              </Text>
              <Text style={styles.txnMeta}>
                {fmtDate(item.transactionDate)} · {item.category ?? 'ללא סיווג'}
              </Text>
            </View>
            <Text style={[styles.txnAmount, { color: expense ? colors.coral : colors.success }]}>
              {expense ? '−' : '+'}
              {fmtMoney(Math.abs(amount))}
            </Text>
          </Pressable>
        )
      }}
    />
  )

  const renderInsights = () => {
    const insightsList = insightLines(recordField(insightsRaw, 'insights'))
    const headline = recordField<string>(narrativeRaw, 'headline')
    const body = recordField<string>(narrativeRaw, 'body')
    const uncategorized = asNum(recordField(coverageRaw, 'uncategorizedCount'))
    const uncShare = asNum(recordField(coverageRaw, 'uncategorizedShare'))

    return (
      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {uncategorized > 0 ? (
          <Card style={[styles.block, styles.warnCard]}>
            <Text style={styles.warnText}>
              {uncategorized} תנועות ללא סיווג ({uncShare}% מההוצאות). כיסוי הנתונים משפיע על דיוק התובנות.
            </Text>
          </Card>
        ) : null}

        {(headline || body) ? (
          <Card style={styles.block}>
            <SectionHeader title="נרטיב" style={styles.sectionInline} />
            {headline ? <Text style={styles.narrativeHeadline}>{headline}</Text> : null}
            {body ? <Text style={styles.narrativeBody}>{body}</Text> : null}
          </Card>
        ) : (
          <Card style={styles.block}>
            <Text style={styles.muted}>נרטיב לא זמין (ייתכן ש-GEMINI_API_KEY לא מוגדר).</Text>
          </Card>
        )}

        <SectionHeader title="תובנות" style={styles.sectionInline} />
        {insightsList.length === 0 ? (
          <EmptyState icon="💡" text="אין תובנות לחודש הנוכחי" compact />
        ) : (
          insightsList.map((line, i) => (
            <Card key={`ins-${i}`} style={styles.insightCard}>
              <Text style={styles.insightText}>{line}</Text>
            </Card>
          ))
        )}
      </ScrollView>
    )
  }

  const renderTrading = () => {
    if (!journal) return <EmptyState icon="📈" text="אין נתוני יומן מסחר" />
    return (
      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.kpiRow}>
          <KpiCard value={asNum(journal.tradesCount)} label="עסקאות" />
          <KpiCard
            value={fmtMoney(journal.realizedPnl)}
            label="P&L ממומש"
            color={asNum(journal.realizedPnl) >= 0 ? colors.success : colors.coral}
          />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard value={fmtMoney(journal.buysNotional)} label="קניות" color={colors.info} />
          <KpiCard value={fmtMoney(journal.sellsNotional)} label="מכירות" color={colors.coral} />
        </View>
        {Array.isArray(journal.trades) && journal.trades.length > 0 ? (
          <Card style={styles.block}>
            <SectionHeader title="עסקאות אחרונות" style={styles.sectionInline} />
            {(journal.trades as Array<Record<string, unknown>>).slice(0, 15).map((t, i) => (
              <ListRow
                key={String(t.id ?? i)}
                label={`${String(t.symbol ?? '—')} · ${t.direction === 'buy' ? 'קנייה' : 'מכירה'}`}
                subtitle={fmtDate(String(t.tradeDate ?? ''))}
                value={fmtMoney(asNum(t.price) * asNum(t.quantity))}
              />
            ))}
          </Card>
        ) : (
          <EmptyState icon="📊" text="אין עסקאות בתקופה" compact />
        )}
      </ScrollView>
    )
  }

  const renderAccounts = () => {
    const accounts = recordField<unknown[]>(accountsRaw, 'accounts') ?? []
    const totalBank = asNum(recordField(accountsRaw, 'totalBankBalance'))
    const totalCard = asNum(recordField(accountsRaw, 'totalCreditCardBalance'))
    const lastSync = recordField<string | null>(accountsRaw, 'lastSyncAt')

    return (
      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.kpiRow}>
          <KpiCard value={fmtMoney(totalBank)} label="יתרת בנק" color={colors.success} />
          <KpiCard value={fmtMoney(totalCard)} label="כרטיסי אשראי" color={colors.coral} />
        </View>
        {lastSync ? (
          <Text style={styles.syncNote}>סנכרון אחרון: {fmtDate(lastSync)}</Text>
        ) : null}
        {accounts.length === 0 ? (
          <EmptyState icon="🏦" text="אין חשבונות מחוברים" />
        ) : (
          <View style={styles.group}>
            {accounts.map((a, i) => {
              const acc = a as Record<string, unknown>
              return (
                <ListRow
                  key={String(acc.id ?? i)}
                  icon={acc.accountType === 'credit_card' ? '💳' : '🏦'}
                  label={String(acc.displayName ?? acc.accountNumber ?? 'חשבון')}
                  subtitle={String(acc.provider ?? '')}
                  value={acc.balance != null ? fmtMoney(acc.balance) : '—'}
                />
              )
            })}
          </View>
        )}
      </ScrollView>
    )
  }

  const renderVat = () => {
    const entryCount = asNum(recordField(vatRaw, 'entryCount'))
    const vatToPay = asNum(recordField(vatRaw, 'vatToPay'))
    const income = asNum(recordField(vatRaw, 'totalIncomeInclVat'))
    const expense = asNum(recordField(vatRaw, 'totalComputedExpense'))

    return (
      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Text style={styles.periodLabel}>
          תקופה {vatPeriod.period} · {vatPeriod.year}
        </Text>
        <View style={styles.kpiRow}>
          <KpiCard value={entryCount} label="רשומות" />
          <KpiCard
            value={fmtMoney(vatToPay)}
            label="מע״מ לתשלום"
            color={vatToPay >= 0 ? colors.coral : colors.success}
          />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard value={fmtMoney(income)} label="הכנסות כולל מע״מ" color={colors.success} />
          <KpiCard value={fmtMoney(expense)} label="הוצאות מוכרות" color={colors.coral} />
        </View>

        <Card style={styles.block}>
          <Text style={styles.devNote}>צילום חשבונית — בפיתוח</Text>
        </Card>
      </ScrollView>
    )
  }

  const body = (() => {
    if (loading && !refreshing) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )
    }
    switch (segment) {
      case 'summary':
        return renderSummary()
      case 'cashflow':
        return renderCashflow()
      case 'insights':
        return renderInsights()
      case 'trading':
        return renderTrading()
      case 'accounts':
        return renderAccounts()
      case 'vat':
        return renderVat()
    }
  })()

  return (
    <View style={styles.flex}>
      <View style={styles.segmentWrap}>
        <SegmentControl
          segments={SEGMENTS}
          selected={segment}
          onSelect={(k) => setSegment(k as SegmentKey)}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexGrow: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segmentWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  scrollPad: { padding: 16, paddingBottom: 32, gap: 12 },
  listPad: { paddingBottom: 24 },
  kpiRow: { flexDirection: 'row-reverse', gap: 10 },
  block: { marginTop: 4 },
  sectionInline: { paddingHorizontal: 0, paddingTop: 0 },
  group: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  txnRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  pressed: { opacity: 0.75 },
  txnMain: { flex: 1, gap: 2 },
  txnTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  txnMeta: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  txnAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  narrativeHeadline: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 8,
  },
  narrativeBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  insightCard: { marginBottom: 8 },
  insightText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  warnCard: { borderColor: colors.coral, backgroundColor: '#fb718512' },
  warnText: {
    color: colors.coral,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 20,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  syncNote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: 8,
  },
  periodLabel: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 4,
  },
  devNote: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
})
