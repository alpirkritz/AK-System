'use client'

import { useState } from 'react'
import { Users, UserPlus, UserMinus, RotateCcw, X, CheckSquare, FileText } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { WarmthBadge } from '@/components/relationship/WarmthBadge'
import { InsightStrands } from '@/components/relationship/InsightStrands'

const ROSTER_PREVIEW = 8

/**
 * Standing roster of a recurring meeting, saved once from the calendar. Per-occurrence
 * exceptions (absent / guest) never touch the roster itself.
 */
export function CircleCard({ seriesId, meetingId }: { seriesId: string; meetingId: string }) {
  const utils = trpc.useUtils()
  const { data: circle } = trpc.circles.get.useQuery({ seriesId })
  const { data: attendance } = trpc.circles.attendance.useQuery({ meetingId })
  const [expanded, setExpanded] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = () => {
    utils.circles.get.invalidate({ seriesId })
    utils.circles.attendance.invalidate({ meetingId })
  }
  const save = trpc.circles.saveFromCalendar.useMutation({ onSuccess: refresh })
  const apply = trpc.circles.applyCalendarDiff.useMutation({ onSuccess: refresh })
  const dismiss = trpc.circles.dismissCalendarDiff.useMutation({ onSuccess: refresh })
  const follow = trpc.circles.follow.useMutation({ onSuccess: refresh })
  const removeMember = trpc.circles.removeMember.useMutation({ onSuccess: refresh })
  const markAbsent = trpc.circles.markAbsent.useMutation({ onSuccess: refresh })
  const addGuest = trpc.circles.addGuest.useMutation({ onSuccess: () => { setNewName(''); refresh() } })
  const addMember = trpc.circles.addMember.useMutation({ onSuccess: () => { setNewName(''); refresh() } })
  const removeException = trpc.circles.removeException.useMutation({ onSuccess: refresh })

  if (!circle) return null
  const saved = !!circle.series.rosterSavedAt
  const absentByRoster = new Map((attendance?.absent ?? []).map((e) => [e.rosterId, e.id]))
  const roster = expanded ? circle.roster : circle.roster.slice(0, ROSTER_PREVIEW)
  const busy = save.isPending || apply.isPending || dismiss.isPending

  return (
    <div className="card mt-5" data-testid="circle-card">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider flex items-center gap-2">
          <Users className="w-3.5 h-3.5" aria-hidden />
          חוג
          {saved && <span className="pill normal-case" data-testid="circle-count">{circle.rosterCount} בחוג</span>}
          {saved && attendance && attendance.expectedCount !== circle.rosterCount && (
            <span className="text-[#647399] normal-case">{attendance.expectedCount} צפויים היום</span>
          )}
        </div>
        <WarmthBadge warmth={circle.warmth} scope="circle" />
      </div>
      {circle.insight && (
        <InsightStrands
          atmosphereText={circle.insight.atmosphereText}
          atmosphere={circle.insight.atmosphere}
          people={circle.insight.people}
          scoreText={circle.insight.scoreText}
          scores={circle.insight.scores}
          insights={circle.insight.insights}
          projectId={circle.insight.projectId}
          peopleHint="מי שמשתתף בסדרה. המגמה מכל השיחות שלו שקשורות לפרויקט."
          embedded
        />
      )}
      {!saved ? (
        <div className="space-y-2">
          <p className="text-sm text-[#97a4c2]">
            {circle.calendarParticipants.length > 0
              ? `${circle.calendarParticipants.length} משתתפים ביומן. שמור אותם פעם אחת כחוג ולא תצטרך להוסיף אותם לכל מפגש.`
              : 'אין משתתפים ביומן לפגישה הזו עדיין. אחרי סנכרון היומן אפשר לשמור אותם כחוג.'}
          </p>
          <button
            type="button"
            className="btn btn-primary text-xs py-1.5 px-3"
            disabled={circle.calendarParticipants.length === 0 || busy}
            onClick={() => save.mutate({ seriesId })}
          >
            {save.isPending ? 'שומר…' : 'שמור חוג מהיומן'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {circle.recommendation && (
            <p
              className="rounded-md px-2.5 py-2 text-sm leading-relaxed"
              style={{ background: 'rgba(232,197,71,0.08)', borderInlineStart: '3px solid #e8c547', color: '#eef3fb' }}
              data-testid="circle-recommendation"
            >
              {circle.recommendation}
            </p>
          )}

          {circle.diff && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 text-xs"
              style={{ background: '#141f36', border: '1px solid #29395d', color: '#b8c4dc' }}
              data-testid="circle-diff"
            >
              <span className="flex-1 min-w-0">
                {[
                  circle.diff.newInCalendar.length > 0 && `${circle.diff.newInCalendar.length} חדשים ביומן`,
                  circle.diff.missingFromCalendar.length > 0 && `${circle.diff.missingFromCalendar.length} כבר לא מוזמנים`,
                ].filter(Boolean).join(' · ')}
                <span className="block text-[#5a688c] truncate">
                  {[
                    ...circle.diff.newInCalendar.map((p) => `+ ${p.name}`),
                    ...circle.diff.missingFromCalendar.map((r) => `− ${r.displayName}`),
                  ].join(', ')}
                </span>
              </span>
              <button type="button" className="btn btn-secondary text-xs py-1 px-2.5" disabled={busy} onClick={() => apply.mutate({ seriesId })}>
                עדכן מהיומן
              </button>
              <button type="button" className="btn btn-ghost text-xs py-1 px-2.5" disabled={busy} onClick={() => dismiss.mutate({ seriesId })}>
                השאר כך
              </button>
            </div>
          )}

          {circle.openLoops.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5a688c] mb-1.5">
                <CheckSquare className="w-3.5 h-3.5" aria-hidden />
                משימות פתוחות מהמפגש האחרון
              </h4>
              <ul className="space-y-1 text-xs text-[#b8c4dc]">
                {circle.openLoops.slice(0, 6).map((l, i) => (
                  <li key={i}>
                    {l.content}
                    {l.owner && <span className="text-[#5a688c]"> · {l.owner}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-[11px] font-semibold text-[#5a688c] mb-1.5">מי בחוג · המפגש הזה</h4>
            <ul className="space-y-0.5" data-testid="circle-roster">
              {roster.map((r) => {
                const absentId = absentByRoster.get(r.id)
                return (
                  <li key={r.id} className="group flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[#141f36] text-xs">
                    <span className={absentId ? 'flex-1 min-w-0 truncate text-[#5a688c] line-through' : 'flex-1 min-w-0 truncate text-[#b8c4dc]'}>
                      {r.displayName}
                      {r.email && <span className="text-[#5a688c] no-underline"> · {r.email}</span>}
                    </span>
                    {r.personId ? (
                      <span className="pill text-[10px]">במעקב</span>
                    ) : (
                      <button type="button" className="btn-ghost text-[11px] inline-flex items-center gap-1" disabled={follow.isPending} onClick={() => follow.mutate({ rosterId: r.id })}>
                        <UserPlus className="w-3 h-3" aria-hidden />
                        עקוב
                      </button>
                    )}
                    {absentId ? (
                      <button type="button" className="btn-ghost text-[11px] inline-flex items-center gap-1" onClick={() => removeException.mutate({ exceptionId: absentId })}>
                        <RotateCcw className="w-3 h-3" aria-hidden />
                        מגיע
                      </button>
                    ) : (
                      <button type="button" className="btn-ghost text-[11px] inline-flex items-center gap-1" onClick={() => markAbsent.mutate({ meetingId, rosterId: r.id })}>
                        <UserMinus className="w-3 h-3" aria-hidden />
                        חסר היום
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`הסר את ${r.displayName} מהחוג`}
                      title="הסר מהחוג"
                      className="text-[#5a688c] hover:text-[#eef3fb] [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => removeMember.mutate({ rosterId: r.id })}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                )
              })}
              {(attendance?.guests ?? []).map((g) => (
                <li key={g.id} className="flex items-center gap-2 py-1 px-1.5 text-xs">
                  <span className="flex-1 min-w-0 truncate text-[#b8c4dc]">{g.displayName}</span>
                  <span className="pill text-[10px]">אורח היום</span>
                  <button type="button" aria-label={`הסר את ${g.displayName}`} className="text-[#5a688c] hover:text-[#eef3fb]" onClick={() => removeException.mutate({ exceptionId: g.id })}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {circle.roster.length > ROSTER_PREVIEW && (
              <button type="button" className="btn-ghost text-[11px] mt-1" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'הצג פחות' : `הצג את כל ה-${circle.roster.length}`}
              </button>
            )}
            <form
              className="flex gap-2 mt-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (newName.trim()) addGuest.mutate({ meetingId, name: newName.trim() })
              }}
            >
              <input className="input flex-1 text-xs" placeholder="שם" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="שם משתתף" />
              <button type="submit" className="btn btn-secondary text-xs py-1 px-2.5" disabled={!newName.trim() || addGuest.isPending}>
                אורח היום
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-2.5"
                disabled={!newName.trim() || addMember.isPending}
                onClick={() => addMember.mutate({ seriesId, name: newName.trim() })}
              >
                הוסף לחוג
              </button>
            </form>
          </div>

          {circle.notes.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5a688c] mb-1.5">
                <FileText className="w-3.5 h-3.5" aria-hidden />
                סיכומים מהסדרה
              </h4>
              <ul className="space-y-1 text-xs">
                {circle.notes.slice(0, 5).map((n) => (
                  <li key={n.id} className="flex gap-2 text-[#b8c4dc]">
                    <span className="text-[#5a688c] tabular-nums shrink-0">
                      {n.date ? new Date(n.date + 'T00:00:00').toLocaleDateString('he-IL') : ''}
                    </span>
                    {n.notionUrl ? (
                      <a href={n.notionUrl} target="_blank" rel="noreferrer" className="truncate hover:text-[#eef3fb]">{n.title}</a>
                    ) : (
                      <span className="truncate">{n.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
