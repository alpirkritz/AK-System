import type { Metadata, Viewport } from 'next'
import dynamic from 'next/dynamic'
import { Heebo } from 'next/font/google'
import './globals.css'
import { TRPCProvider } from '@/contexts/TRPCProvider'
import { DashboardLayout } from '@/components/DashboardLayout'
import { PushSubscription } from '@/components/PushSubscription'

const SessionProvider = dynamic(
  () => import('@/components/SessionProvider').then((m) => ({ default: m.SessionProvider })),
  { ssr: false }
)

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-heebo',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0e1626',
}

export const metadata: Metadata = {
  title: 'ARO',
  description: 'סביבת עבודה אישית – פגישות, אנשים, משימות',
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ARO',
  },
  // Next.js's `appleWebApp.capable` only emits the legacy Apple-prefixed meta
  // tag; Chrome also wants the standard one (no `other` shorthand exists yet).
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`dark ${heebo.variable}`}>
      <body className="min-h-screen bg-[#0e1626] text-[#eef3fb]">
        <SessionProvider>
          <TRPCProvider>
            <DashboardLayout>{children}</DashboardLayout>
            <PushSubscription />
          </TRPCProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
