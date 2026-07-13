import type { View } from '../lib/types'

const VIEW_LABELS: Record<View, string> = { day: 'יום', week: 'שבוע', month: 'חודש' }

interface CalendarHeaderProps {
  view: View
  headerLabel: string
  eventCount: number
  isConnected: boolean
  isLoading: boolean
  syncStatus: 'idle' | 'loading' | 'done'
  syncResult: { created: number; updated: number; deleted: number } | null
  onSetView: (v: View) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSyncNow: () => void
}

export default function CalendarHeader({
  view,
  headerLabel,
  eventCount,
  isConnected,
  isLoading,
  syncStatus,
  syncResult,
  onSetView,
  onPrev,
  onNext,
  onToday,
  onSyncNow,
}: CalendarHeaderProps) {
  return (
    <div className="border-b border-[#1d2b46] bg-[#0a1120] shrink-0">
      {/* Row 1: title, view switcher, nav, date */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 px-3 md:px-5 py-2 md:py-2.5">
        <h1 className="text-base font-semibold tracking-tight text-[#eef3fb]">יומן</h1>

        <div className="hidden md:block w-px h-5 bg-[#1d2b46] mx-0.5" />

        {/* View switcher */}
        <div className="flex rounded-lg overflow-hidden border border-[#29395d]" role="group" aria-label="בחירת תצוגה">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => onSetView(v)}
              aria-pressed={view === v}
              title={`${VIEW_LABELS[v]} (${v.charAt(0).toUpperCase()})`}
              className={`px-3 py-1.5 text-xs font-medium transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60
                focus-visible:ring-inset focus-visible:z-10
                active:scale-[0.97]
                ${view === v
                  ? 'bg-[#2dd4bf]/10 text-[#2dd4bf] border-x border-[#2dd4bf]/25'
                  : 'text-[#5a688c] hover:text-[#b8c4dc] hover:bg-[#141f36]'
                }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        <div className="hidden md:block w-px h-5 bg-[#1d2b46] mx-0.5" />

        {/* Today button */}
        <button
          onClick={onToday}
          title="חזור להיום (T)"
          className="text-xs px-3 py-1.5 rounded-lg border border-[#2f4368] text-[#6f7ea0]
            hover:text-[#2dd4bf] hover:border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/5
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60
            active:scale-[0.97]"
        >
          היום
        </button>

        {/* Navigation arrows */}
        <div className="flex gap-0.5">
          <button
            onClick={onPrev}
            aria-label="הקודם"
            title="הקודם"
            className="w-8 h-8 flex items-center justify-center rounded-lg
              text-[#5a688c] hover:text-[#cdd7ea] hover:bg-[#16233b] transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60
              active:scale-[0.95]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={onNext}
            aria-label="הבא"
            title="הבא"
            className="w-8 h-8 flex items-center justify-center rounded-lg
              text-[#5a688c] hover:text-[#cdd7ea] hover:bg-[#16233b] transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60
              active:scale-[0.95]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Date label */}
        <span className="text-sm text-[#8593b3] font-medium select-none">{headerLabel}</span>

        {/* Event count pill */}
        {!isLoading && isConnected && eventCount > 0 && (
          <span className="hidden sm:inline text-[10px] text-[#5a688c] bg-[#141f36] px-2 py-0.5 rounded-full">
            {eventCount} אירועים
          </span>
        )}

        <div className="flex-1" />

        {/* Sync controls */}
        {isConnected && (
          <div className="flex items-center gap-2">
            {syncStatus === 'done' && syncResult !== null && (
              <span
                className="hidden sm:inline text-[11px] px-2.5 py-1 rounded-full"
                style={{
                  background: '#34d39922',
                  color: '#34d399',
                  border: '1px solid #34d39944',
                }}
              >
                {syncResult.created === 0 && syncResult.updated === 0 && syncResult.deleted === 0
                  ? 'הכל מעודכן'
                  : [
                      syncResult.created > 0 && `${syncResult.created} חדשות`,
                      syncResult.updated > 0 && `${syncResult.updated} עודכנו`,
                      syncResult.deleted > 0 && `${syncResult.deleted} הוסרו`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
              </span>
            )}
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncStatus === 'loading'}
              title="סנכרן פגישות מהיומן לטבלת הפגישות"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-[#29395d] text-[#647399]
                hover:text-[#2dd4bf] hover:border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/5
                transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#647399] disabled:hover:bg-transparent disabled:hover:border-[#29395d]"
            >
              {syncStatus === 'loading' ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-[#5a688c] border-t-[#2dd4bf] rounded-full animate-spin" />
                  <span className="hidden sm:inline">מסנכרן…</span>
                </span>
              ) : (
                'סנכרן'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
