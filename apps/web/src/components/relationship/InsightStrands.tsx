'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { trpc } from '@/lib/trpc'

type AtmosphereItem = {
  meetingId: string
  date: string
  title: string
  mood: string | null
  subtext: string | null
}

type ScoreItem = {
  meetingId: string
  date: string
  title: string
  score: number | null
  rationale: string | null
}

type PersonItem = {
  personId: string
  name: string
  color: string | null
  trend: 'warming' | 'cooling' | 'stable' | null
  text: string
}

type InsightItem = {
  meetingId: string
  title: string
  text: string
}

type Panel = 'insights' | 'atmosphere' | 'people' | 'scores'

const POSITIVE = /collaborat|productive|positive|warm|energ|engaged|constructive|friendly|aligned|optimis|חיובי|פורה|שיתופי|חם|אנרגטי|מעורב/i
const NEGATIVE = /tense|tension|frustrat|conflict|negative|cold|disengag|defensive|stress|confus|hostile|מתוח|מתיחות|תסכול|קונפליקט|שלילי|קר|לחוץ|מבולבל/i

function lexicon(text: string | null): number {
  if (!text) return 0
  const pos = POSITIVE.test(text)
  const neg = NEGATIVE.test(text)
  if (pos && !neg) return 1
  if (neg && !pos) return -1
  return 0
}

function moodTone(mood: string | null, subtext: string | null): number {
  return (lexicon(mood) * 2 + lexicon(subtext)) / 3
}

function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : date
}

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <p dir="auto" className="text-sm text-[#eef3fb] leading-6 break-words whitespace-pre-wrap mt-1">
      <span className="text-[#647399]">{label}: </span>
      {text}
    </p>
  )
}

function When({ item }: { item: { meetingId: string; date: string; title: string } }) {
  return (
    <div className="text-xs text-[#647399]">
      <span dir="ltr">{dayLabel(item.date)}</span>
      {' · '}
      <Link href={`/meetings/${item.meetingId}`} className="break-words">{item.title}</Link>
    </div>
  )
}

function TrendChart({ scores, atmosphere }: { scores: ScoreItem[]; atmosphere: AtmosphereItem[] }) {
  const moodByMeeting = new Map(atmosphere.map((item) => [item.meetingId, moodTone(item.mood, item.subtext)]))
  const ordered = [...scores].filter((item) => item.score != null).reverse()
  if (ordered.length < 2) return null

  const w = 640
  const h = 52
  const padX = 6
  const padY = 6
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const xAt = (i: number) => padX + (i / (ordered.length - 1)) * innerW
  const yAt = (score: number) => padY + innerH - (score / 10) * innerH
  const line = ordered.map((item, i) => `${xAt(i)},${yAt(item.score ?? 0)}`).join(' ')
  const first = ordered[0]
  const last = ordered[ordered.length - 1]

  return (
    <div dir="ltr" className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="קו מגמת איכות השיחות, מהישן לחדש">
        <line x1={padX} x2={w - padX} y1={yAt(5)} y2={yAt(5)} stroke="#2a3550" strokeWidth="1" strokeDasharray="2 5" />
        <polyline points={line} fill="none" stroke="#8aa0bd" strokeWidth="1.15" strokeLinejoin="round" strokeLinecap="round" />
        {ordered.map((item, i) => {
          const tone = moodByMeeting.get(item.meetingId) ?? 0
          const dot = tone > 0.15 ? '#2dd4bf' : tone < -0.15 ? '#fb7185' : '#94a3b8'
          return (
            <circle key={item.meetingId} cx={xAt(i)} cy={yAt(item.score ?? 0)} r={2.4} fill={dot}>
              <title>{`${item.title} · ${item.score}/10`}</title>
            </circle>
          )
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-[#647399] mt-1">
        <span>{first?.date}</span>
        <span>{last?.date}</span>
      </div>
      <p className="text-[11px] text-[#647399] mt-1" dir="rtl">הקו: איכות השיחה. הנקודה: אווירה, חמה או קרה. משמאל ישן, מימין אחרון.</p>
    </div>
  )
}

export function InsightStrands({
  atmosphereText,
  atmosphere,
  people,
  scoreText,
  scores,
  insights = [],
  peopleHint = 'מי שמשתתף, והמגמה מכל השיחות שלו שקשורות לפרויקט.',
  embedded = false,
  projectId = null,
}: {
  atmosphereText: string
  atmosphere: AtmosphereItem[]
  people: PersonItem[]
  scoreText: string
  scores: ScoreItem[]
  insights?: InsightItem[]
  peopleHint?: string
  embedded?: boolean
  projectId?: string | null
}) {
  const [open, setOpen] = useState<Panel | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const standing = trpc.projects.getStanding.useQuery({ id: projectId ?? '' }, { enabled: !!projectId })
  const writeStanding = trpc.projects.writeStanding.useMutation({
    onSuccess: () => { void standing.refetch() },
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const room = atmosphere.filter((item) => item.mood?.trim() || item.subtext?.trim())
  const graded = scores.filter((item) => item.score != null)
  const coolingPeople = people.filter((person) => person.trend === 'cooling')
  const warmingPeople = people.filter((person) => person.trend === 'warming')
  const cooling = coolingPeople.length
  const warming = warmingPeople.length
  const moodLabel = atmosphereText.includes('מתחממ')
    ? 'מתחממת'
    : atmosphereText.includes('מתקרר')
      ? 'מתקררת'
      : atmosphereText.includes('יציב')
        ? 'יציבה'
        : 'פירוט'
  const latestScore = graded[0]?.score
  const roomTone = atmosphereText.includes('מתקרר') ? 'cooling' : atmosphereText.includes('מתחממ') ? 'warming' : 'neutral'
  const peopleTone = cooling > 0 ? 'cooling' : warming > 0 ? 'warming' : 'neutral'
  const scoreTone = scoreText.includes('ירד') ? 'cooling' : scoreText.includes('עלה') ? 'warming' : 'neutral'

  const choose = (panel: Panel) => {
    setOpen((current) => (current === panel ? null : panel))
  }

  return (
    <section className={embedded ? 'mb-4' : 'card mb-6'} data-testid="insight-strands">
      <h2 className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider">איפה זה עומד</h2>
      <div className="mt-2">
        <Verdict label="אווירה" text={atmosphereText || 'עוד אין תמונת אווירה.'} tone={roomTone} />
        <Verdict label="אנשים" text={peopleHeadline(people)} tone={peopleTone} />
        <Verdict label="ציון" text={scoreText || 'עוד אין ציון.'} tone={scoreTone} />
      </div>
      {standing?.stale && <p className="text-xs text-[#fbbf24] mt-2">יש שיחות חדשות מאז התמצית.</p>}
      <button
        type="button"
        className="w-full min-h-[44px] mt-1 flex items-center justify-between text-sm text-[#97a4c2]"
        aria-expanded={detailOpen}
        onClick={() => setDetailOpen((current) => !current)}
      >
        <span>פירוט</span>
        <Chevron open={detailOpen} />
      </button>

      {detailOpen && (
      <div className="max-h-[46vh] overflow-y-auto overscroll-contain">
      <StandingBrief projectId={projectId} standing={standing.data} pending={writeStanding.isPending} error={writeStanding.error?.message ?? null} onWrite={() => projectId && writeStanding.mutate({ id: projectId })} />

      <div className="mt-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#eef3fb]">מגמת איכות</h3>
        {moodLabel !== 'פירוט' && (
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              color: moodLabel === 'מתקררת' ? '#fb7185' : '#2dd4bf',
              background: moodLabel === 'מתקררת' ? '#3a1d28' : '#12352f',
            }}
          >
            {moodLabel}
          </span>
        )}
      </div>
      <TrendChart scores={scores} atmosphere={atmosphere} />

      <PeoplePanel
        people={people}
        hint={peopleHint}
        listOpen={listOpen}
        onToggle={() => setListOpen((current) => !current)}
      />

      <div className="grid grid-cols-3 gap-2 mt-4 sticky top-0 z-10 bg-[#1a2740] py-2 -mx-1 px-1">
        <StrandButton label="תובנות" value={insights.length ? `${insights.length}` : 'אין'} active={open === 'insights'} onClick={() => choose('insights')} />
        <StrandButton label="אווירה" value={moodLabel} active={open === 'atmosphere'} onClick={() => choose('atmosphere')} />
        <StrandButton label="ציון" value={latestScore != null ? `${latestScore}/10` : 'אין'} active={open === 'scores'} onClick={() => choose('scores')} />
      </div>

      {open && (
        <div ref={panelRef} className="mt-2 border-t border-[#2f4368] pt-4 max-h-[46vh] overflow-y-auto overscroll-contain">
          {open === 'insights' && (
            insights.length === 0 ? <Empty text="עוד אין תובנות שמורות." /> : (
              <ol className="space-y-5">
                {insights.map((item) => (
                  <li key={item.meetingId}>
                    <Link href={`/meetings/${item.meetingId}`} className="text-xs text-[#647399] break-words">{item.title}</Link>
                    <p dir="auto" className="text-sm text-[#eef3fb] leading-6 break-words whitespace-pre-wrap mt-1">{item.text}</p>
                  </li>
                ))}
              </ol>
            )
          )}
          {open === 'atmosphere' && (
            <>
              {atmosphereText && <p className="text-sm text-[#eef3fb] mb-3">{atmosphereText}</p>}
              <p className="text-xs text-[#647399] mb-3">מה קורה בחדר.</p>
              {room.length === 0 ? <Empty text="עוד אין תיאור אווירה." /> : (
                <ol className="space-y-5">
                  {room.map((item) => (
                    <li key={item.meetingId}>
                      <When item={item} />
                      {item.mood?.trim() && <Quote label="אווירה" text={item.mood.trim()} />}
                      {item.subtext?.trim() && <Quote label="מתחת לפני השטח" text={item.subtext.trim()} />}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {open === 'scores' && (
            <>
              {scoreText && <p className="text-sm text-[#eef3fb] mb-3">{scoreText}</p>}
              <p className="text-xs text-[#647399] mb-3">איכות השיחה.</p>
              {graded.length === 0 ? <Empty text="עוד אין ציון." /> : (
                <ol className="space-y-5">
                  {graded.map((item) => (
                    <li key={item.meetingId}>
                      <When item={item} />
                      <p className="text-sm text-[#eef3fb] mt-1" dir="ltr">{item.score}/10</p>
                      {item.rationale?.trim() && (
                        <p dir="auto" className="text-sm text-[#b8c4dc] leading-6 break-words whitespace-pre-wrap mt-1">{item.rationale.trim()}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}
      </div>
      )}
    </section>
  )
}

function PeoplePanel({
  people,
  hint,
  listOpen,
  onToggle,
}: {
  people: PersonItem[]
  hint: string
  listOpen: boolean
  onToggle: () => void
}) {
  const flags = people.filter((person) => person.trend === 'cooling' || person.trend === 'warming')
  if (people.length === 0) return null
  return (
    <div className="mt-4 space-y-3">
      {flags.length > 0 && (
        <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(251,191,36,0.45)', background: '#2a2112' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#fbbf24]">דגלים — שינויים לאורך זמן</p>
            <span className="text-[#fbbf24]" aria-hidden>⚠</span>
          </div>
          <ul className="mt-2 space-y-2">
            {flags.map((person) => (
              <li key={person.personId} dir="auto" className="text-sm leading-6 break-words whitespace-pre-wrap text-[#f3e6c4]">
                {person.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="w-full min-h-[48px] rounded-2xl border border-[#2a3550] bg-[#121a2c] px-4 flex items-center justify-between text-sm text-[#eef3fb]"
        aria-expanded={listOpen}
        onClick={onToggle}
      >
        <span>כל האנשים</span>
        <span className="flex items-center gap-3 text-[#97a4c2]">
          <span>{people.length}</span>
          <Chevron open={listOpen} />
        </span>
      </button>
      {listOpen && (
        <div className="space-y-2">
          <p className="text-xs text-[#647399] px-1">{hint}</p>
          <ul className="space-y-2">
            {people.map((person) => (
              <li key={person.personId} className="rounded-2xl border border-[#2a3550] bg-[#121a2c] px-4 py-3">
                <p className="text-sm font-semibold text-[#eef3fb]">{person.name}</p>
                <p dir="auto" className="text-sm leading-6 break-words whitespace-pre-wrap text-[#d5deef]">{person.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0" style={{ transform: open ? 'rotate(90deg)' : 'rotate(180deg)' }}>
      <path d="M6 3.5 L10.5 8 L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function peopleHeadline(people: PersonItem[]): string {
  const cooling = people.filter((person) => person.trend === 'cooling')
  const warming = people.filter((person) => person.trend === 'warming')
  if (cooling.length === 1) return cooling[0].text
  if (cooling.length > 1) return `${joinNames(cooling.map((person) => person.name))} מתקררים.`
  if (warming.length === 1) return warming[0].text
  if (warming.length > 1) return `${joinNames(warming.map((person) => person.name))} מתחממים.`
  if (people.length === 0) return 'עוד אין אנשים משויכים.'
  return 'אין שינוי בקשרים.'
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} ו${names[1]}`
  return `${names[0]}, ${names[1]} ועוד ${names.length - 2}`
}

function Verdict({ label, text, tone }: { label: string; text: string; tone: 'warming' | 'cooling' | 'neutral' }) {
  const color = tone === 'cooling' ? '#fb7185' : tone === 'warming' ? '#2dd4bf' : '#eef3fb'
  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-3 items-baseline py-1.5">
      <span className="text-xs text-[#647399]">{label}</span>
      <span className="text-sm font-medium leading-5" style={{ color }}>{text}</span>
    </div>
  )
}

function formatBriefAt(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function StandingBrief({
  projectId,
  standing,
  pending,
  error,
  onWrite,
}: {
  projectId: string | null
  standing: { brief: string | null; briefAt: string | null; stale: boolean } | undefined
  pending: boolean
  error: string | null
  onWrite: () => void
}) {
  if (!projectId) {
    return <p className="text-sm text-[#97a4c2] mt-3">שייך לפרויקט כדי לכתוב תמצית.</p>
  }
  return (
    <div className="mt-3">
      {standing?.brief ? (
        <p dir="auto" className="text-sm text-[#eef3fb] leading-6 break-words whitespace-pre-wrap">{standing.brief}</p>
      ) : (
        <p className="text-sm text-[#97a4c2]">עוד אין תמצית.</p>
      )}
      {standing?.briefAt && (
        <p className="text-xs text-[#647399] mt-2">נותח לאחרונה {formatBriefAt(standing.briefAt)}</p>
      )}
      {standing?.stale && <p className="text-xs text-[#fbbf24] mt-1">יש שיחות חדשות מאז התמצית.</p>}
      {error && <p className="text-sm text-[#fb7185] mt-2">{error}</p>}
      <button
        type="button"
        className="btn btn-ghost text-xs mt-2 min-h-[44px]"
        disabled={pending}
        onClick={onWrite}
      >
        {pending ? 'כותב תמצית…' : standing?.brief ? 'נתח שוב' : 'כתוב תמצית'}
      </button>
    </div>
  )
}

function StrandButton({
  label,
  value,
  active,
  onClick,
  tone = 'neutral',
}: {
  label: string
  value: string
  active: boolean
  onClick: () => void
  tone?: 'warming' | 'cooling' | 'neutral'
}) {
  const valueColor = tone === 'cooling' ? '#fb7185' : tone === 'warming' ? '#2dd4bf' : '#eef3fb'
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className="min-h-[44px] rounded-lg border px-3 py-2 text-start"
      style={{ borderColor: active ? '#2dd4bf' : '#2f4368', background: active ? '#16343a' : 'transparent' }}
    >
      <span className="block text-[11px] text-[#647399]">{label}</span>
      <span className="block text-sm font-semibold" style={{ color: valueColor }}>{value}</span>
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-[#97a4c2]">{text}</p>
}
