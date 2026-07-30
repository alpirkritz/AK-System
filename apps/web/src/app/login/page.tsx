'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'
  const error = searchParams.get('error')
  const [busy, setBusy] = useState(false)

  async function handleGoogleSignIn() {
    setBusy(true)
    try {
      await signIn('google', { callbackUrl })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0e1626]">
      <div className="card w-full max-w-sm p-8 text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/icons/aro-logo.png"
            alt="ARO"
            width={112}
            height={112}
            className="h-28 w-28 rounded-2xl"
          />
          <h1 className="sr-only">ARO</h1>
          <p className="text-sm text-[#7a89ab]">התחבר עם Google כדי להמשיך</p>
        </div>

        {error ? (
          <p className="text-sm text-red-400">
            {error === 'AccessDenied' ? 'אין הרשאה לחשבון זה' : 'התחברות נכשלה — נסה שוב'}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={busy}
          onClick={() => void handleGoogleSignIn()}
        >
          {busy ? 'מתחבר…' : 'התחבר עם Google'}
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#0e1626]" />}>
      <LoginForm />
    </Suspense>
  )
}
