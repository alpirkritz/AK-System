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
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#1a1a1a] bg-[#080808] shrink-0">
      {/* Title */}
      <h1 className="text-base font-semibold tracking-tight text-[#f0ede6]">יומן</h1>

      <div className="w-px h-5 bg-[#1a1a1a] mx-0.5" />

      {/* View switcher — segmented control with aria-pressed for clear active state */}
      <div className="flex rounded-lg overflow-hidden border border-[#222]" role="group" aria-label="בחירת תצוגה">
        {(['day', 'week', 'month'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => onSetView(v)}
            aria-pressed={view === v}
            title={`${VIEW_LABELS[v]} (${v.charAt(0).toUpperCase()})`}
            className={`px-3 py-1.5 text-xs font-medium transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
              focus-visible:ring-inset focus-visible:z-10
              active:scale-[0.97]
              ${view === v
                ? 'bg-[#e8c547]/10 text-[#e8c547] border-x border-[#e8c547]/25'
                : 'text-[#555] hover:text-[#ccc] hover:bg-[#141414]'
              }`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-[#1a1a1a] mx-0.5" />

      {/* Today button */}
      <button
        onClick={onToday}
        title="חזור להיום (T)"
        className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[#777]
          hover:text-[#e8c547] hover:border-[#e8c547]/40 hover:bg-[#e8c547]/5
          transition-all duration-150
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
          active:scale-[0.97]"
      >
        היום
      </button>

      {/* Navigation arrows — in RTL: first child = right side */}
      <div className="flex gap-0.5">
        <button
          onClick={onPrev}
          aria-label="הקודם"
          title="הקודם"
          className="w-8 h-8 flex items-center justify-center rounded-lg
            text-[#555] hover:text-[#ddd] hover:bg-[#161616] transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
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
            text-[#555] hover:text-[#ddd] hover:bg-[#161616] transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
            active:scale-[0.95]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Date label */}
      <span className="text-sm text-[#999] font-medium select-none">{headerLabel}</span>

      {/* Event count pill */}
      {!isLoading && isConnected && eventCount > 0 && (
        <span className="text-[10px] text-[#555] bg-[#141414] px-2 py-0.5 rounded-full">
          {eventCount} אירועים
        </span>
      )}

      <div className="flex-1" />

      {/* Sync controls */}
      {isConnected && (
        <div className="flex items-center gap-2">
          {syncStatus === 'done' && syncResult !== null && (
            <span
              className="text-[11px] px-2.5 py-1 rounded-full"
              style={{
                background: '#47b86e22',
                color: '#47b86e',
                border: '1px solid #47b86e44',
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
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-[#222] text-[#666]
              hover:text-[#e8c547] hover:border-[#e8c547]/40 hover:bg-[#e8c547]/5
              transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#666] disabled:hover:bg-transparent disabled:hover:border-[#222]"
          >
            {syncStatus === 'loading' ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-[#555] border-t-[#e8c547] rounded-full animate-spin" />
                מסנכרן…
              </span>
            ) : (
              'סנכרן'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
