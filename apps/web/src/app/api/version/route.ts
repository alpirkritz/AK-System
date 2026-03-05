import { NextResponse } from 'next/server'

/** GET /api/version — version info (Second Brain spec) */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    version: process.env.npm_package_version ?? '0.1.0',
    app: 'ak-system',
  })
}
