function getBridgeEnv() {
  const url = process.env.WHATSAPP_BRIDGE_URL
  const secret = process.env.WHATSAPP_BRIDGE_SECRET
  return { url, secret, configured: !!(url && secret) }
}

export function isBridgeConfigured(): boolean {
  return getBridgeEnv().configured
}

export async function bridgeFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const { url, secret, configured } = getBridgeEnv()
  if (!configured) {
    throw new Error('WhatsApp bridge not configured (WHATSAPP_BRIDGE_URL / WHATSAPP_BRIDGE_SECRET)')
  }
  const res = await fetch(`${url!.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}

export interface DiscoveredGroup {
  jid: string
  name: string
  participantCount: number
  lastMessageAt: number | null
}

export interface BridgeStatus {
  connected: boolean
  selfJid: string
  qrAvailable: boolean
  lastError: string | null
}

export interface GroupRulePayload {
  jid: string
  name: string
  enabled: boolean
  fomoEnabled: boolean
  fomoThreshold: number
  fomoWindowMinutes: number
  keywords: string[]
  summaryTimes: string[]
  labelSummaryTimes: string[]
  lastFomoAlertAt: string | null
}

export async function discoverGroups(): Promise<DiscoveredGroup[]> {
  const { ok, data } = await bridgeFetch<{ groups?: DiscoveredGroup[]; error?: string }>(
    '/groups/available'
  )
  if (!ok) {
    throw new Error((data as { error?: string }).error || 'Failed to discover groups')
  }
  return data.groups ?? []
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  const { ok, data } = await bridgeFetch<BridgeStatus>('/status')
  if (!ok) throw new Error('Failed to fetch bridge status')
  return data
}

export async function pushConfigToBridge(groups: GroupRulePayload[]): Promise<void> {
  const { ok, data } = await bridgeFetch<{ error?: string }>('/config/reload', {
    method: 'POST',
    body: JSON.stringify({ groups }),
  })
  if (!ok) {
    throw new Error((data as { error?: string }).error || 'Failed to reload bridge config')
  }
}

export async function summarizeGroup(groupJid: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await bridgeFetch<{ ok?: boolean; error?: string }>('/groups/summarize', {
    method: 'POST',
    body: JSON.stringify({ groupJid }),
  })
  if (!ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Summarize failed' }
  }
  return { ok: true }
}
