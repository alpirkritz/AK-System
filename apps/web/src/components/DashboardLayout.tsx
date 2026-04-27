'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'

const navSections = [
  {
    title: 'מרכז הבקרה',
    items: [
      { href: '/', label: 'דשבורד', icon: '⬡' },
      { href: '/projects', label: 'פרויקטים', icon: '📁' },
      { href: '/meetings', label: 'פגישות', icon: '◈' },
      { href: '/people', label: 'אנשים', icon: '◉' },
      { href: '/tasks', label: 'משימות', icon: '◻' },
      { href: '/recurring', label: 'חוזרות', icon: '↻' },
      { href: '/calendar', label: 'יומן גוגל', icon: '📅' },
      { href: '/finance', label: 'פיננסים', icon: '💰' },
      { href: '/updates', label: 'עדכונים', icon: '📰' },
      { href: '/chat', label: 'צ\'אט', icon: '💬' },
      { href: '/trading-journal', label: 'יומן מסחר', icon: '📈' },
    ],
  },
  {
    title: 'מערכת',
    items: [
      { href: '/settings', label: 'הגדרות', icon: '⚙' },
    ],
  },
]

const PRIMARY_TABS = [
  { href: '/', label: 'דשבורד', icon: '⬡' },
  { href: '/projects', label: 'פרויקטים', icon: '📁' },
  { href: '/meetings', label: 'פגישות', icon: '◈' },
  { href: '/people', label: 'אנשים', icon: '◉' },
  { href: '/tasks', label: 'משימות', icon: '◻' },
]

const MORE_ITEMS = [
  { href: '/recurring', label: 'חוזרות', icon: '↻' },
  { href: '/calendar', label: 'יומן גוגל', icon: '📅' },
  { href: '/finance', label: 'פיננסים', icon: '💰' },
  { href: '/updates', label: 'עדכונים', icon: '📰' },
  { href: '/chat', label: 'צ\'אט', icon: '💬' },
  { href: '/trading-journal', label: 'יומן מסחר', icon: '📈' },
  { href: '/settings', label: 'הגדרות', icon: '⚙' },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const isMoreActive = MORE_ITEMS.some((item) => isActive(item.href))

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="w-[220px] flex-shrink-0 border-l border-[#1a1a1a] flex-col p-6 gap-1 sticky top-0 h-screen hidden lg:flex">
        <div className="px-3 pb-5 border-b border-[#1a1a1a] mb-2">
          <div className="text-lg font-bold tracking-tight">My Space</div>
          <div className="text-[11px] text-[#555] mt-0.5">סביבת עבודה אישית</div>
        </div>
        <nav className="flex-1 overflow-y-auto space-y-1">
          {navSections.map((section) => (
            <div key={section.title}>
              <h2 className="text-[11px] font-medium text-[#555] uppercase tracking-wider mb-2 px-3">
                {section.title}
              </h2>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
                    >
                      <span className="text-base opacity-80">{item.icon}</span>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-[#1a1a1a] px-3">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="nav-item w-full text-right text-[#666] hover:text-[#e8c547]"
          >
            התנתק
          </button>
        </div>
      </aside>

      {/* Main content with responsive padding and bottom nav spacing */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 pb-20 lg:pb-8 overflow-y-auto">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t border-[#1a1a1a]"
        style={{
          background: '#161616',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-stretch h-14">
          {PRIMARY_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors ${
                isActive(tab.href) ? 'text-[#e8c547]' : 'text-[#666]'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors border-none bg-transparent ${
              isMoreActive || moreOpen ? 'text-[#e8c547]' : 'text-[#666]'
            }`}
          >
            <span className="text-lg leading-none">⋯</span>
            <span className="text-[10px] font-medium">עוד</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="fixed bottom-14 inset-x-0 z-50 lg:hidden rounded-t-2xl border-t border-[#2a2a2a] overflow-hidden"
            style={{
              background: '#161616',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="p-4 grid grid-cols-3 gap-2">
              {MORE_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl transition-colors min-h-[44px] ${
                    isActive(item.href)
                      ? 'bg-[#e8c547]/10 text-[#e8c547]'
                      : 'text-[#888] active:bg-[#1f1f1f]'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  signOut({ callbackUrl: '/' })
                }}
                className="col-span-3 flex items-center justify-center gap-2 py-3 rounded-xl text-[#666] active:bg-[#1f1f1f] min-h-[44px]"
              >
                התנתק
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
