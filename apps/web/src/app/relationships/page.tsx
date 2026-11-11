'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { RelationshipCard, type BoardCard, type BoardTrend } from '@/components/relationship/RelationshipCard'

const PersonDetailDrawer = dynamic(
  () => import('@/components/people/PersonDetailDrawer').then((m) => m.PersonDetailDrawer),
  { ssr: false },
)

type PersonSection = 'needs' | 'handled' | 'good' | 'steady' | 'thin'

function personSection(card: BoardCard): PersonSection {
  const a = card.attention
  if (!a || a.status == null) return 'thin'
  if (a.status === 'needs_1on1') return a.suppressed ? 'handled' : 'needs'
  return a.status === 'good' ? 'good' : 'steady'
}

const PERSON_SECTIONS: { title: string; key: PersonSection; collapsed?: boolean }[] = [
  { title: 'צריך 1:1', key: 'needs' },
  { title: 'בטיפול', key: 'handled' },
  { title: 'במצב טוב', key: 'good', collapsed: true },
  { title: 'יציבים', key: 'steady', collapsed: true },
  { title: 'עוד אין מספיק קשר כדי לשפוט', key: 'thin', collapsed: true },
]

const CIRCLE_SECTIONS: { title: string; trend: BoardTrend }[] = [
  { title: 'חוגים מתקררים', trend: 'cooling' },
  { title: 'חוגים מתחממים', trend: 'warming' },
  { title: 'חוגים יציבים', trend: 'stable' },
  { title: 'חוגים בלי מגמה עדיין', trend: null },
]

export default function RelationshipsPage() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data, isLoading, isError, refetch } = trpc.insights.relationshipBoard.useQuery()
  const [personId, setPersonId] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ analysed: number; failed: number } | null>(null)
  const run = trpc.insights.runAnalysisBacklog.useMutation({
    onSuccess: async (r) => {
      setLastRun({ analysed: r.analysed, failed: r.failed })
      await utils.insights.relationshipBoard.invalidate()
    },
  })

  const people = data?.people ?? []
  const circles = data?.circles ?? []
  const summary = data?.summary
  const pending = summary?.pendingBacklog ?? 0
  const nothingAnalysed = !isLoading && !isError && (summary?.analysedMeetings ?? 0) === 0
  const empty = !isLoading && !isError && people.length + circles.length === 0

  const openCircle = (id: string) => {
    const meetingId = circles.find((c) => c.id === id)?.timeline[0]?.meetingId
    if (meetingId) router.push(`/meetings/${meetingId}`)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-[#eef3fb]">קשרים</h1>
        <p className="text-sm text-[#7a89ab] mt-1">מי צריך שיחה אישית ממך, לפי הטון בפגישות ולפי מתי דיברתם לאחרונה בכל ערוץ.</p>
      </header>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="card h-12 animate-pulse" />
          <div className="card h-28 animate-pulse" />
          <div className="card h-28 animate-pulse" />
        </div>
      ) : null}

      {isError ? (
        <div className="card p-4 space-y-2">
          <p className="text-sm text-red-400">לא הצלחנו לטעון את הקשרים.</p>
          <button type="button" className="btn btn-primary text-xs" onClick={() => void refetch()}>נסה שוב</button>
        </div>
      ) : null}

      {summary ? (
        <div className="card p-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="relationships-summary">
          <p className="text-xs text-[#97a4c2] flex flex-wrap gap-x-3 gap-y-1">
            <Stat n={summary.analysedMeetings} label="שיחות מנותחות" />
            <Stat n={summary.peopleWithData} label="אנשים" />
            {summary.circlesWithData > 0 ? <Stat n={summary.circlesWithData} label="חוגים" /> : null}
            <Stat n={pending} label="ממתינות לניתוח" dim={pending === 0} />
          </p>
          <div className="ms-auto flex items-center gap-2">
            {lastRun ? (
              <span className="text-[11px] text-[#4ade80]">
                נותחו {lastRun.analysed}{lastRun.failed > 0 ? ` · ${lastRun.failed} נכשלו` : ''}
              </span>
            ) : null}
            {run.isError ? <span className="text-[11px] text-red-400">הניתוח נכשל. נסה שוב.</span> : null}
            {pending > 0 ? (
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={run.isPending}
                onClick={() => { setLastRun(null); run.mutate({ limit: 5 }) }}
              >
                {run.isPending ? 'מנתח…' : `נתח עכשיו (${Math.min(5, pending)})`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {nothingAnalysed ? (
        <p className="text-sm text-[#97a4c2] leading-relaxed">
          {pending > 0
            ? `עוד אין שיחות מנותחות. ${pending} שיחות עם סיכום מחכות לניתוח — לחץ ״נתח עכשיו״, או חכה: הניתוח האוטומטי מטפל בכמה שיחות כל 10 דקות.`
            : 'אין שיחות עם סיכום בחצי השנה האחרונה. הקשרים נבנים מסיכומי הפגישות בנושן.'}
        </p>
      ) : empty ? (
        <p className="text-sm text-[#97a4c2]">
          יש {summary?.analysedMeetings} שיחות מנותחות, אבל אף אחת מהן לא מקושרת לאיש קשר מאושר. קשר אנשים לפגישות כדי שיופיעו פה.
        </p>
      ) : null}

      {!isLoading && !isError && people.length > 0 && !people.some((c) => personSection(c) === 'needs') ? (
        <p className="text-sm text-[#4ade80]" data-testid="relationships-all-clear">אף אחד לא מחכה ל-1:1 כרגע.</p>
      ) : null}
      {PERSON_SECTIONS.map((s) => (
        <Section
          key={s.title}
          title={s.title}
          cards={people.filter((c) => personSection(c) === s.key)}
          subject="person"
          onOpen={setPersonId}
          collapsible={s.collapsed}
        />
      ))}
      {CIRCLE_SECTIONS.map((s) => (
        <Section
          key={s.title}
          title={s.title}
          cards={circles.filter((c) => c.trend === s.trend)}
          subject="circle"
          onOpen={openCircle}
        />
      ))}
      {personId ? <PersonDetailDrawer personId={personId} onClose={() => setPersonId(null)} /> : null}
    </div>
  )
}

function Stat({ n, label, dim }: { n: number; label: string; dim?: boolean }) {
  return (
    <span className={dim ? 'text-[#5a688c]' : undefined}>
      <span className="tabular-nums font-semibold text-[#eef3fb]">{n}</span> {label}
    </span>
  )
}

function Section({
  title,
  cards,
  subject,
  onOpen,
  collapsible = false,
}: {
  title: string
  cards: BoardCard[]
  subject: 'person' | 'circle'
  onOpen: (id: string) => void
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(!collapsible)
  if (cards.length === 0) return null
  const heading = (
    <>
      {title} <span className="text-[#3f4c6b] font-normal">· {cards.length}</span>
    </>
  )
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider">
        {collapsible ? (
          <button type="button" className="inline-flex items-center gap-1 hover:text-[#97a4c2]" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span aria-hidden>{open ? '▾' : '◂'}</span> {heading}
          </button>
        ) : heading}
      </h2>
      {open ? cards.map((card) => (
        <RelationshipCard key={card.id} card={card} subject={subject} onOpen={() => onOpen(card.id)} />
      )) : null}
    </section>
  )
}
