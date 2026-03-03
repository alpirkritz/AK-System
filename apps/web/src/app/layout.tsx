import type { Metadata } from 'next'
import './globals.css'
import { TRPCProvider } from '@/contexts/TRPCProvider'
import { DashboardLayout } from '@/components/DashboardLayout'

export const metadata: Metadata = {
  title: 'My Space – AK System',
  description: 'סביבת עבודה אישית – פגישות, אנשים, משימות',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className="dark">
      <body className="min-h-screen bg-[#0f0f0f] text-[#f0ede6]">
        <TRPCProvider>
          <DashboardLayout>{children}</DashboardLayout>
        </TRPCProvider>
      </body>
    </html>
  )
}
