'use client'

import { memo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type Severity = 'info' | 'attention' | 'urgent'

interface InsightSource {
  nodeId: string
  kind: string
  label: string
}

interface Insight {
  id: string
  kind: string
  title: string
  body: string
  severity: string
  score: number
  personId: string | null
  sources: InsightSource[]
  generatedAt: string
}

const SEVERITY_COLOR: Record<Severity, string> = {
  urgent: '#e8474a',
  attention: '#e8c547',
  info: '#4d9cf0',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  urgent: 'דחוף',
  attention: 'לשים לב',
  info: 'לידיעה',
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  person: 'איש קשר',
  meeting: 'פגישה',
  commitment: 'התחייבות',
  financial_event: 'פיננסי',
  whatsapp_signal: 'וואטסאפ',
  voice_recording: 'הקלטה',
  email_thread: 'מייל',
}

function severityOf(raw: string): Severity {
  return raw === 'urgent' || raw === 'attention' ? raw : 'info'
}

const SVG_LINK = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.6.6M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.6-.6"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
)

const InsightCard = memo(function InsightCard({
  insight,
  onDismiss,
  dismissing,
}: {
  insight: Insight
  onDismiss: () => void
  dismissing: boolean
}) {
  const severity = severityOf(insight.severity)
  const color = SEVERITY_COLOR[severity]

  return (
    <article
      className="card p-3 mb-2.5 border-r-2"
      style={{ borderRightColor: color }}
      aria-label={insight.title}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5"
          style={{ background: `${color}22`, color }}
        >
          {SEVERITY_LABEL[severity]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-[#cdd7ea]">{insight.title}</h3>
          <p className="text-[12px] text-[#8593b3] mt-1 leading-relaxed">{insight.body}</p>
        </div>
      </div>

      {insight.sources.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2 border-t border-[#1e2740]">
          <span className="text-[10px] text-[#4d659c] shrink-0">מבוסס על:</span>
          {insight.sources.slice(0, 4).map((s) => (
            <span
              key={s.nodeId}
              className="text-[10px] px-1.5 py-0.5 rounded-md text-[#7a89ab]"
              style={{ background: 'rgba(255,255,255,0.04)' }}
              title={s.label}
            >
              {SOURCE_KIND_LABEL[s.kind] ?? s.kind} · {s.label.slice(0, 24)}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2.5">
        {insight.personId && (
          <Link
            href={`/people?person=${insight.personId}`}
            className="btn btn-ghost text-[12px] py-1 px-3 no-underline"
          >
            פתח כרטיס
          </Link>
        )}
        <button
          type="button"
          className="btn btn-ghost text-[12px] py-1 px-3"
          onClick={onDismiss}
          disabled={dismissing}
          aria-label={`דחה את התובנה "${insight.title}"`}
        >
          {dismissing ? '...' : 'דחה'}
        </button>
      </div>
    </article>
  )
})

const PREVIEW_COUNT = 3

/**
 * Cross-domain insights from the harness. Hidden entirely when nothing is open —
 * the dashboard should not carry an empty section for a background process.
 */
export function HarnessWidget() {
  const [expanded, setExpanded] = useState(false)
  const [dismissingId, setDismissingId] = useState<string | null>(null)

  const { data: insights = [], isLoading, refetch } = trpc.harness.insights.useQuery({ limit: 12 })
  const dismiss = trpc.harness.dismissInsight.useMutation({
    onSuccess: () => {
      refetch()
      setDismissingId(null)
    },
    onError: () => setDismissingId(null),
  })

  if (isLoading || insights.length === 0) return null

  const list = insights as Insight[]
  const visible = expanded ? list : list.slice(0, PREVIEW_COUNT)
  const urgentCount = list.filter((i) => i.severity === 'urgent').length

  return (
    <section aria-label="תובנות חוצות-תחומים">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[#4d9cf0]">{SVG_LINK}</span>
        <h2 className="text-base font-semibold text-[#eef3fb]">תובנות חוצות-תחומים</h2>
        {urgentCount > 0 && (
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(232,71,74,0.2)', color: '#e8474a' }}
          >
            {urgentCount}
          </span>
        )}
        <div className="flex-1" />
        {list.length > PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[#647399] hover:text-[#8593b3] transition-colors py-1 px-2 rounded"
            aria-expanded={expanded}
          >
            {expanded ? 'צמצם' : `עוד ${list.length - PREVIEW_COUNT}`}
          </button>
        )}
      </div>

      {visible.map((insight) => (
        <InsightCard
          key={insight.id}
          insight={insight}
          dismissing={dismissingId === insight.id}
          onDismiss={() => {
            setDismissingId(insight.id)
            dismiss.mutate({ id: insight.id })
          }}
        />
      ))}
    </section>
  )
}
