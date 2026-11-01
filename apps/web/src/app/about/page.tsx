import Link from 'next/link'

export const metadata = { title: 'ARO — About' }

export default function AboutPage() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0e1626]">
      <div className="card w-full max-w-xl p-8 space-y-4">
        <h1 className="text-xl font-semibold">ARO / AK System</h1>
        <p className="text-sm text-[#b8c4de]">
          ARO היא סביבת עבודה אישית פרטית לניהול פגישות, אנשים ומשימות. היא משמשת משתמש יחיד
          (הבעלים), והגישה אליה מוגבלת לחשבון שלו.
        </p>
        <p className="text-sm text-[#b8c4de]" dir="ltr">
          ARO is a private, single-user personal workspace for meetings, people and tasks. It is
          operated by its owner for personal use only. The &quot;AK System Backup&quot; Google OAuth
          app is used solely to store encrypted backups of the owner&apos;s own data in the owner&apos;s
          own Google Drive.
        </p>
        <Link href="/privacy" className="text-sm text-[#2dd4bf] underline">
          Privacy policy / מדיניות פרטיות
        </Link>
      </div>
    </main>
  )
}
