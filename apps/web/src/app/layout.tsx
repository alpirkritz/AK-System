import type { Metadata, Viewport } from 'next'
import { Heebo } from 'next/font/google'
import './globals.css'
import { TRPCProvider } from '@/contexts/TRPCProvider'
import { DashboardLayout } from '@/components/DashboardLayout'
import { PushSubscription } from '@/components/PushSubscription'

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
  themeColor: '#0f0f0f',
}

export const metadata: Metadata = {
  title: 'My Space – AK System',
  description: 'סביבת עבודה אישית – פגישות, אנשים, משימות',
  icons: { icon: '/favicon.ico' },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'My Space',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`dark ${heebo.variable}`}>
      <body className="min-h-screen bg-[#0f0f0f] text-[#f0ede6]">
        <TRPCProvider>
          <DashboardLayout>{children}</DashboardLayout>
          <PushSubscription />
        </TRPCProvider>
      </body>
    </html>
  )
}
