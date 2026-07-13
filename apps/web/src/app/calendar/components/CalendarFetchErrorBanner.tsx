type GoogleError = { email: string; message: string }

export default function CalendarFetchErrorBanner({
  errors,
}: {
  errors: GoogleError[]
}) {
  if (errors.length === 0) return null

  return (
    <div className="mx-4 mt-4 mb-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5 text-red-300">
          !
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-red-200 mb-1.5 text-sm">
            לא ניתן לטעון אירועים מ-Google Calendar
          </p>
          <ul className="text-[#999] text-[13px] mb-3 leading-relaxed space-y-1">
            {errors.map((e) => (
              <li key={e.email}>
                <span className="text-[#bbb]">{e.email}:</span> {e.message}
              </li>
            ))}
          </ul>
          <a href="/settings" className="btn btn-primary text-xs inline-flex">
            לחיבור מחדש →
          </a>
        </div>
      </div>
    </div>
  )
}
