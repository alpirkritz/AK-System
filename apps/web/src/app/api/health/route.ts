import { NextResponse } from 'next/server'

/** GET /api/health — health check (Second Brain spec) */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok' })
}
