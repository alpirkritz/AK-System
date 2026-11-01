import Link from 'next/link'

export const metadata = { title: 'ARO — Privacy Policy' }

const CONTACT_EMAIL = 'alpirkritz@gmail.com'

export default function PrivacyPage() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0e1626]">
      <div className="card w-full max-w-xl p-8 space-y-4">
        <h1 className="text-xl font-semibold">מדיניות פרטיות / Privacy Policy</h1>

        <section className="space-y-2 text-sm text-[#b8c4de]">
          <p>
            ARO היא כלי אישי פרטי של משתמש יחיד. המידע נשמר על שרת בבעלות הבעלים ואינו נמכר, משותף
            או מועבר לצדדים שלישיים.
          </p>
          <p>
            אפליקציית ה-OAuth &quot;AK System Backup&quot; מבקשת הרשאה אחת בלבד:
            <span dir="ltr"> drive.file</span>. היא יכולה לגשת רק לקבצים ולתיקיות שהיא עצמה יצרה
            בחשבון ה-Google Drive של הבעלים, ושם היא שומרת גיבויים מוצפנים של המידע של הבעלים. היא
            אינה קוראת או משנה אף קובץ אחר ב-Drive.
          </p>
        </section>

        <section className="space-y-2 text-sm text-[#b8c4de]" dir="ltr">
          <p>
            ARO is a private, single-user tool. Data is stored on a server owned by its operator and
            is never sold, shared with, or disclosed to third parties.
          </p>
          <p>
            The &quot;AK System Backup&quot; Google OAuth app requests a single scope,{' '}
            <code>drive.file</code>. It can only access files and folders it created itself in the
            operator&apos;s own Google Drive, where it stores encrypted (age) backups of the
            operator&apos;s own data. It does not read, list, or modify any other file in Drive, and
            Google user data is not used for any other purpose.
          </p>
          <p>
            Contact: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <Link href="/about" className="text-sm text-[#2dd4bf] underline">
          About / אודות
        </Link>
      </div>
    </main>
  )
}
