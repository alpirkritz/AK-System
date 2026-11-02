/**
 * Shared-secret auth for the local work-comms bridge's ingest endpoints.
 * The bridge (on Alpir's Mac) sends `Authorization: Bearer <WORK_COMMS_BRIDGE_SECRET>`.
 */
export function verifyWorkCommsAuth(request: Request): boolean {
  const secret = process.env.WORK_COMMS_BRIDGE_SECRET
  if (!secret) return false
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return token === secret
}
