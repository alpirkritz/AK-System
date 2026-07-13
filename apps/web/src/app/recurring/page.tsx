'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Recurring meetings are now a filter inside /meetings.
export default function RecurringRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/meetings?filter=recurring')
  }, [router])

  return (
    <div className="flex items-center justify-center h-[50vh] text-[#647399] text-sm">
      מעביר לפגישות חוזרות…
    </div>
  )
}
