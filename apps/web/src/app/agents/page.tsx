'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The agents chat is now unified into the assistant workspace at /chat.
export default function AgentsRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const agent = params.get('agent')
    router.replace(agent ? `/chat?agent=${encodeURIComponent(agent)}` : '/chat')
  }, [router])

  return (
    <div className="flex items-center justify-center h-[50vh] text-[#647399] text-sm">
      מעביר לעוזר…
    </div>
  )
}
