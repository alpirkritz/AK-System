import { useEffect } from 'react'
import type { CalEvent, RsvpStatus } from '../lib/types'
import { RSVP_DOT_COLOR, RSVP_LABEL } from '../lib/constants'
import { fmtTime, fmtFullDate } from '../lib/date-utils'
import { eventStyle } from '../lib/event-utils'

function RsvpBadge({ rsvp }: { rsvp: RsvpStatus }) {
  const dot = RSVP_DOT_COLOR[rsvp]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full font-medium"
      style={{ background: dot + '22', color: dot, border: `1px solid ${dot}44` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      {RSVP_LABEL[rsvp]}
    </span>
  )
}

function isLink(str: string) {
  return (
    str.startsWith('http') ||
    str.includes('meet.google') ||
    str.includes('zoom.us') ||
    str.includes('teams.microsoft')
  )
}

function meetingLinkLabel(url: string) {
  if (url.includes('meet.google')) return 'Google Meet — לחץ להצטרפות'
  if (url.includes('zoom.us')) return 'Zoom — לחץ להצטרפות'
  if (url.includes('teams.microsoft')) return 'Teams — לחץ להצטרפות'
  return url
}

interface DetailRowProps {
  icon: React.ReactNode
  children: React.ReactNode
}

function DetailRow({ icon, children }: DetailRowProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#141414] flex items-center justify-center shrink-0 mt-0.5 text-[#555]">
        {icon}
      </div>
      <div className="flex-1 min-w-0 pt-1">{children}</div>
    </div>
  )
}

interface EventDetailPanelProps {
  event: CalEvent | null
  onClose: () => void
}

export default function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!event) return null

  const s = eventStyle(event)
  const isCancelled = event.status === 'cancelled'
  const isTentativeStatus = event.status === 'tentative'
  const dateStr = fmtFullDate(event.start)
  const timeStr = event.isAllDay ? 'כל היום' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-20 bg-black/50 backdrop-blur-[2px] cursor-pointer transition-opacity duration-200"
        onClick={onClose}
        aria-label="לחץ לסגירה"
      />

      {/* Panel */}
      <div
        className="animate-slide-in-left absolute left-0 top-0 bottom-0 z-30 w-[340px] bg-[#0c0c0c] flex flex-col shadow-2xl"
        style={{ borderRight: '1px solid #1a1a1a' }}
        role="dialog"
        aria-label={event.title}
      >
        {/* Color accent strip at top */}
        <div className="h-1 shrink-0" style={{ background: s.border }} />

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex-1 min-w-0">
            {/* Status badges */}
            {(isCancelled || isTentativeStatus || (event.rsvp && event.rsvp !== 'accepted')) && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {isCancelled && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-400">
                    בוטל
                  </span>
                )}
                {isTentativeStatus && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400">
                    ממתין לאישור
                  </span>
                )}
                {event.rsvp && event.rsvp !== 'accepted' && <RsvpBadge rsvp={event.rsvp} />}
              </div>
            )}
            <h2
              className={`text-[15px] font-semibold leading-snug
                ${isCancelled || event.rsvp === 'declined' ? 'line-through text-[#555]' : 'text-[#eee]'}`}
            >
              {event.title}
            </h2>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="סגור"
            title="סגור (Esc)"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555]
              hover:text-white hover:bg-[#1a1a1a] transition-all duration-150 shrink-0
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60"
          >
            <svg width="12" height="12" viewBox="0 0 11 11" fill="none">
              <path d="M1 1L10 10M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
          {/* Date & time */}
          <DetailRow
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            }
          >
            <div className="text-sm text-[#ccc] leading-tight">{dateStr}</div>
            <div className="text-xs text-[#666] mt-0.5 font-mono">{timeStr}</div>
          </DetailRow>

          {/* RSVP status */}
          {event.rsvp && (
            <DetailRow
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              }
            >
              <RsvpBadge rsvp={event.rsvp} />
            </DetailRow>
          )}

          {/* Calendar source */}
          {event.calendarName && (
            <DetailRow
              icon={
                <span className="w-3 h-3 rounded-full" style={{ background: s.border }} />
              }
            >
              <span className="text-sm text-[#aaa]">{event.calendarName}</span>
              <span className="text-[10px] text-[#444] mr-1.5">
                {(event.calendarId || '').startsWith('apple:') ? '· Exchange/Mac' : '· Google'}
              </span>
            </DetailRow>
          )}

          {/* Divider before location/description */}
          {(event.location || event.description) && (
            <div className="border-t border-[#141414]" />
          )}

          {/* Location */}
          {event.location && (
            <DetailRow
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              }
            >
              <div className="min-w-0">
                {isLink(event.location) ? (
                  <a
                    href={event.location}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors break-all leading-snug
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60 rounded"
                  >
                    {meetingLinkLabel(event.location)}
                  </a>
                ) : (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#aaa] hover:text-blue-400 transition-colors leading-snug
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60 rounded"
                  >
                    {event.location}
                    <span className="text-[#555] mr-1 text-xs">↗</span>
                  </a>
                )}
              </div>
            </DetailRow>
          )}

          {/* Description */}
          {event.description && (
            <DetailRow
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="17" y1="10" x2="3" y2="10"/>
                  <line x1="21" y1="6" x2="3" y2="6"/>
                  <line x1="21" y1="14" x2="3" y2="14"/>
                  <line x1="17" y1="18" x2="3" y2="18"/>
                </svg>
              }
            >
              <div
                className="text-sm text-[#777] leading-relaxed break-words min-w-0 [&_a]:text-blue-400 [&_a]:hover:underline"
                dangerouslySetInnerHTML={{
                  __html: event.description
                    .replace(/<script[^>]*>.*?<\/script>/gi, '')
                    .replace(/<style[^>]*>.*?<\/style>/gi, '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .replace(/\n/g, '<br/>')
                    .trim(),
                }}
              />
            </DetailRow>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#141414] px-5 py-3">
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 text-xs text-[#555]
              hover:text-[#aaa] transition-colors py-2 rounded-lg hover:bg-[#0f0f0f]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            פתח בגוגל קלנדר
          </a>
        </div>
      </div>
    </>
  )
}
