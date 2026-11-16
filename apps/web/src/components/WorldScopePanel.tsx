'use client'

import { trpc } from '@/lib/trpc'

/**
 * Which calendar belongs to which world, and links that cross worlds (spec: project-world-scoping).
 * Worlds come from the workspaces table — nothing here is hardcoded.
 */
export function WorldScopePanel() {
  const utils = trpc.useUtils()
  const { data: worlds = [] } = trpc.worlds.list.useQuery()
  const { data: calendars = [], isLoading: calLoading } = trpc.worlds.calendars.list.useQuery()
  const { data: conflicts = [], isLoading: conflictsLoading } = trpc.worlds.conflicts.useQuery()
  const refresh = () => {
    void utils.worlds.invalidate()
    void utils.projects.list.invalidate()
    void utils.meetings.list.invalidate()
  }
  const setCalendar = trpc.worlds.calendars.set.useMutation({ onSuccess: refresh })
  const resolve = trpc.worlds.resolveConflict.useMutation({ onSuccess: refresh })
  const reresolve = trpc.worlds.reresolve.useMutation({ onSuccess: refresh })

  type World = { id: string; name: string; projectCount: number; meetingCount: number }
  type Cal = { calendarId: string; label: string; meetingCount: number; workspaceId: string | null }
  type Conflict = { kind: 'meeting' | 'task'; id: string; title: string; projectName: string; itemWorldName: string; projectWorldName: string }

  return (
    <section className="mt-8 space-y-4" data-testid="world-scope-panel">
      <div>
        <h2 className="text-sm font-bold text-[#b8c4dc]">פרויקטים לפי עולם</h2>
        <p className="text-[11px] text-[#647399] mt-0.5">
          לכל פרויקט עולם אחד. פגישה מקבלת עולם מהסדרה, מבסיס הפגישות ב-Notion (קשר אותו לעולם בחלון העריכה של העולם), מהיומן או מהמשתתפים — ולא תקושר לפרויקט מעולם אחר.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {(worlds as World[]).map((w) => (
            <span key={w.id} className="text-[11px] px-2 py-0.5 rounded-full border border-[#29395d] text-[#97a4c2]">
              {w.name} · {w.projectCount} פרויקטים · {w.meetingCount} פגישות
            </span>
          ))}
          <button
            type="button"
            className="btn btn-ghost text-[11px] py-0.5 px-2"
            disabled={reresolve.isPending}
            onClick={() => reresolve.mutate()}
          >
            {reresolve.isPending ? 'מחשב…' : 'חשב עולמות מחדש'}
          </button>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="text-[12px] font-semibold text-[#cdd7ea]">יומנים</div>
        {calLoading ? (
          <p className="text-[11px] text-[#5a688c]">טוען…</p>
        ) : (calendars as Cal[]).length === 0 ? (
          <p className="text-[11px] text-[#5a688c]">עוד לא סונכרנו פגישות מיומן.</p>
        ) : (
          <ul className="space-y-1.5">
            {(calendars as Cal[]).map((c) => (
              <li key={c.calendarId} className="flex flex-wrap items-center justify-between gap-2" data-testid="world-calendar-row">
                <span className="text-[12px] text-[#97a4c2] min-w-0 truncate" dir="ltr" title={c.calendarId}>
                  {c.label} <span className="text-[#5a688c]">({c.meetingCount})</span>
                </span>
                <select
                  className="select text-[12px] py-1 w-auto"
                  value={c.workspaceId ?? ''}
                  aria-label={`עולם ליומן ${c.label}`}
                  onChange={(e) => setCalendar.mutate({ calendarId: c.calendarId, workspaceId: e.target.value || null })}
                >
                  <option value="">ללא עולם</option>
                  {(worlds as World[]).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card space-y-2">
        <div className="text-[12px] font-semibold text-[#cdd7ea]">קישורים בין עולמות</div>
        {conflictsLoading ? (
          <p className="text-[11px] text-[#5a688c]">טוען…</p>
        ) : (conflicts as Conflict[]).length === 0 ? (
          <p className="text-[11px] text-[#5a688c]">אין קישורים בין עולמות.</p>
        ) : (
          <ul className="space-y-2">
            {(conflicts as Conflict[]).map((c) => (
              <li key={`${c.kind}:${c.id}`} className="flex flex-wrap items-center justify-between gap-2" data-testid="world-conflict-row">
                <span className="text-[12px] text-[#cdd7ea]">
                  {c.kind === 'meeting' ? 'פגישה' : 'משימה'} «{c.title}» ({c.itemWorldName}) ← פרויקט {c.projectName} ({c.projectWorldName})
                </span>
                <span className="flex gap-1.5">
                  <button type="button" className="btn btn-ghost text-[11px] py-1 px-2" onClick={() => resolve.mutate({ kind: c.kind, id: c.id, action: 'unlink' })}>
                    נתק פרויקט
                  </button>
                  <button type="button" className="btn btn-ghost text-[11px] py-1 px-2" onClick={() => resolve.mutate({ kind: c.kind, id: c.id, action: 'move' })}>
                    העבר ל-{c.projectWorldName}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
