'use client'

import dynamic from 'next/dynamic'
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then((m) => m.ChatPanel), { ssr: false })

export default function ChatPage() {
  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-4rem)]">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold tracking-tight">צ&apos;אט</h1>
      </div>
      <div className="flex-1 border border-[#1a1a1a] rounded-xl overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  )
}
