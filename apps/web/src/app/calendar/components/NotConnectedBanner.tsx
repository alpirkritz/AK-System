export default function NotConnectedBanner() {
  return (
    <div className="flex-1 flex items-start justify-center p-8">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-6 w-full max-w-lg">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <p className="font-semibold text-amber-200 mb-1.5 text-sm">יומן Google לא מחובר</p>
            <p className="text-[#999] text-[13px] mb-3 leading-relaxed">
              חבר את חשבונות Google שלך (אישי ודאז) מהגדרות כדי לראות אירועים ולגשת ל-Gmail.
            </p>
            <a
              href="/settings"
              className="btn btn-primary text-xs inline-flex"
            >
              לחיבור חשבונות →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
