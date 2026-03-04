'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
    ],
  },
  {
    title: 'מערכת',
    items: [
      { href: '/settings', label: 'הגדרות', icon: '⚙' },
    ],
  },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-[220px] flex-shrink-0 border-l border-[#1a1a1a] flex flex-col p-6 gap-1 sticky top-0 h-screen hidden lg:flex">
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
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  )
}
