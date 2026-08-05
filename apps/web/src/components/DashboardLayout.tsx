'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  ListChecks,
  FolderKanban,
  CalendarDays,
  Sparkles,
  Wallet,
  Newspaper,
  BookMarked,
  Bell,
  Settings,
  LogOut,
  MoreHorizontal,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { NotificationBell } from './NotificationBell'

const QuickAddTaskModal = dynamic(
  () => import('./QuickAddTaskModal').then((m) => m.QuickAddTaskModal),
  { ssr: false },
)

type NavItem = { href: string; label: string; icon: LucideIcon }

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'היום',
    items: [{ href: '/', label: 'דשבורד', icon: LayoutDashboard }],
  },
  {
    title: 'עבודה',
    items: [
      { href: '/meetings', label: 'פגישות', icon: CalendarCheck },
      { href: '/people', label: 'אנשים', icon: Users },
      { href: '/tasks', label: 'משימות', icon: ListChecks },
      { href: '/projects', label: 'פרויקטים', icon: FolderKanban },
    ],
  },
  {
    title: 'יומן',
    items: [{ href: '/calendar', label: 'יומן גוגל', icon: CalendarDays }],
  },
  {
    title: 'עוזר חכם',
    items: [{ href: '/chat', label: 'עוזר', icon: Sparkles }],
  },
  {
    title: 'מידע',
    items: [
      { href: '/finance', label: 'פיננסים', icon: Wallet },
      { href: '/updates', label: 'עדכונים', icon: Newspaper },
      { href: '/reading-list', label: 'רשימת קריאה', icon: BookMarked },
    ],
  },
  {
    title: 'מערכת',
    items: [
      { href: '/notifications', label: 'התראות', icon: Bell },
      { href: '/settings', label: 'הגדרות', icon: Settings },
    ],
  },
]

const PRIMARY_TABS: NavItem[] = [
  { href: '/', label: 'דשבורד', icon: LayoutDashboard },
  { href: '/meetings', label: 'פגישות', icon: CalendarCheck },
  { href: '/tasks', label: 'משימות', icon: ListChecks },
  { href: '/people', label: 'אנשים', icon: Users },
  { href: '/chat', label: 'עוזר', icon: Sparkles },
]

const MORE_ITEMS: NavItem[] = [
  { href: '/projects', label: 'פרויקטים', icon: FolderKanban },
  { href: '/calendar', label: 'יומן גוגל', icon: CalendarDays },
  { href: '/finance', label: 'פיננסים', icon: Wallet },
  { href: '/updates', label: 'עדכונים', icon: Newspaper },
  { href: '/reading-list', label: 'רשימת קריאה', icon: BookMarked },
  { href: '/notifications', label: 'התראות', icon: Bell },
  { href: '/settings', label: 'הגדרות', icon: Settings },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [taskAddedMessage, setTaskAddedMessage] = useState<string | null>(null)
  const fabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!taskAddedMessage) return
    const timer = setTimeout(() => setTaskAddedMessage(null), 2500)
    return () => clearTimeout(timer)
  }, [taskAddedMessage])

  // Auth screen and printable documents: render bare, no app chrome.
  if (pathname === '/login' || pathname.endsWith('/print')) {
    return <>{children}</>
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    if (href === '/chat') return pathname.startsWith('/chat') || pathname.startsWith('/agents')
    return pathname.startsWith(href)
  }

  const isMoreActive = MORE_ITEMS.some((item) => isActive(item.href))

  return (
    <div className="flex min-h-screen">
      {/* Desktop / tablet sidebar */}
      <aside className="w-[220px] flex-shrink-0 border-l border-[#22314f] flex-col p-6 gap-1 sticky top-0 h-screen hidden md:flex">
        <div className="px-3 pb-5 border-b border-[#22314f] mb-2 flex items-center gap-3">
          <img
            src="/icons/aro-logo.png"
            alt="ARO"
            width={40}
            height={40}
            className="h-10 w-10 rounded-lg flex-shrink-0"
          />
          <div>
            <div className="text-lg font-bold tracking-tight">ARO</div>
            <div className="text-[11px] text-[#647399] mt-0.5">סביבת עבודה אישית</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto space-y-4">
          {navSections.map((section) => (
            <div key={section.title}>
              <h2 className="text-[11px] font-medium text-[#647399] uppercase tracking-wider mb-2 px-3">
                {section.title}
              </h2>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
                      >
                        <Icon size={18} className="opacity-90" strokeWidth={2} />
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-[#22314f] px-3">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="nav-item w-full text-right text-[#647399] hover:text-[#2dd4bf]"
          >
            <LogOut size={18} className="opacity-90" strokeWidth={2} />
            התנתק
          </button>
        </div>
      </aside>

      {/* Main content with responsive padding and bottom nav spacing */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 pb-20 md:pb-8 overflow-y-auto">
        <div className="flex justify-end mb-4 md:mb-6">
          <NotificationBell />
        </div>
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed bottom-0 inset-x-0 z-50 md:hidden border-t border-[#22314f]"
        style={{
          background: '#16233b',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-stretch h-14">
          {PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors ${
                  isActive(tab.href) ? 'text-[#2dd4bf]' : 'text-[#647399]'
                }`}
              >
                <Icon size={20} strokeWidth={2} />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors border-none bg-transparent ${
              isMoreActive || moreOpen ? 'text-[#2dd4bf]' : 'text-[#647399]'
            }`}
          >
            <MoreHorizontal size={20} strokeWidth={2} />
            <span className="text-[10px] font-medium">עוד</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="fixed bottom-14 inset-x-0 z-50 md:hidden rounded-t-2xl border-t border-[#2f4368] overflow-hidden"
            style={{
              background: '#16233b',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="p-4 grid grid-cols-3 gap-2">
              {MORE_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl transition-colors min-h-[44px] ${
                      isActive(item.href)
                        ? 'bg-[#2dd4bf]/10 text-[#2dd4bf]'
                        : 'text-[#97a4c2] active:bg-[#223052]'
                    }`}
                  >
                    <Icon size={22} strokeWidth={2} />
                    <span className="text-xs font-medium">{item.label}</span>
                  </Link>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  signOut({ callbackUrl: '/' })
                }}
                className="col-span-3 flex items-center justify-center gap-2 py-3 rounded-xl text-[#647399] active:bg-[#223052] min-h-[44px]"
              >
                <LogOut size={18} strokeWidth={2} />
                התנתק
              </button>
            </div>
          </div>
        </>
      )}

      {/* Global quick-add — hidden while the mobile "more" drawer is open */}
      {!moreOpen && (
        <button
          ref={fabRef}
          type="button"
          className="fab"
          aria-label="הוסף משימה"
          onClick={() => setQuickAddOpen(true)}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      <QuickAddTaskModal
        open={quickAddOpen}
        onClose={() => {
          setQuickAddOpen(false)
          fabRef.current?.focus()
        }}
        onCreated={(sync) =>
          setTaskAddedMessage(sync && !sync.ok ? 'נוספה משימה, אבל לא נוצרה ב-Notion' : 'נוספה משימה')
        }
      />

      {taskAddedMessage && (
        <div className="toast" role="status">
          {taskAddedMessage}
        </div>
      )}
    </div>
  )
}
