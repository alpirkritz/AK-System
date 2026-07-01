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
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0f0f0f]">
      <div className="card w-full max-w-sm p-8 text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#e8c547]">My Space</h1>
          <p className="text-sm text-[#888] mt-2">התחבר עם Google כדי להמשיך</p>
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
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#0f0f0f]" />}>
      <LoginForm />
    </Suspense>
  )
}
