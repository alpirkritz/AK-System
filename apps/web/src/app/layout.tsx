import type { Metadata } from 'next'
import { Heebo } from 'next/font/google'
import './globals.css'
import { TRPCProvider } from '@/contexts/TRPCProvider'
import { DashboardLayout } from '@/components/DashboardLayout'

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-heebo',
})

export const metadata: Metadata = {
  title: 'My Space – AK System',
  description: 'סביבת עבודה אישית – פגישות, אנשים, משימות',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`dark ${heebo.variable}`}>
      <body className="min-h-screen bg-[#0f0f0f] text-[#f0ede6]">
        <TRPCProvider>
          <DashboardLayout>{children}</DashboardLayout>
        </TRPCProvider>
      </body>
    </html>
  )
}
