import { eq } from 'drizzle-orm'
import { getDb, queryRows, notificationPreferences, pushSubscriptions, expoPushTokens } from '@ak-system/database'
import { isBridgeConfigured } from './whatsapp-bridge-client'

export type NotificationChannel = 'whatsapp' | 'push' | 'telegram'
export type NotificationCategory = 'cron' | 'agent' | 'whatsapp' | 'hugo'

export interface NotificationTypeDef {
  id: string
  category: NotificationCategory
  label: string
  description: string
  availableChannels: NotificationChannel[]
  schedulable: boolean
  defaultTime?: string
  /** Whether this event can run an ABC agent instead of the built-in template. */
  routable?: boolean
  /** Suggested agent for the UI picker (not auto-applied). */
  suggestedAgentId?: string
}

const ALL_CHANNELS: NotificationChannel[] = ['whatsapp', 'push', 'telegram']
const PUSH_ONLY: NotificationChannel[] = ['push']

/** Static catalog of every notification the system can emit. */
export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  {
    id: 'morning_briefing',
    category: 'cron',
    label: 'תדריך בוקר',
    description: 'סיכום היומן והמשימות של היום',
    availableChannels: ALL_CHANNELS,
    schedulable: true,
    defaultTime: '07:00',
    routable: true,
    suggestedAgentId: '06_calendar_optimizer',
  },
  {
    id: 'task_reminder',
    category: 'cron',
    label: 'תזכורת משימות',
    description: 'נשלח כשמשימה מגיעה למועד או באיחור — לא ניתן לקבוע שעה',
    availableChannels: ALL_CHANNELS,
    schedulable: false,
    routable: true,
  },
  {
    id: 'pre_meeting_briefing',
    category: 'cron',
    label: 'הכנה לפגישה',
    description: '15 דקות לפני כל פגישה',
    availableChannels: ALL_CHANNELS,
    schedulable: false,
    routable: true,
    suggestedAgentId: '04_meeting_prep_herald',
  },
  {
    id: 'daily_meeting_summary',
    category: 'cron',
    label: 'סיכום יומי',
    description: 'סיכום הפגישות של היום בסוף היום',
    availableChannels: ALL_CHANNELS,
    schedulable: true,
    defaultTime: '20:00',
    routable: true,
    suggestedAgentId: '03_morning_briefing',
  },
  {
    id: 'feed_digest',
    category: 'cron',
    label: 'עדכון חדשות',
    description: 'תקציר כתבות מהפידים שהוגדרו',
    availableChannels: ALL_CHANNELS,
    schedulable: false,
  },
  {
    id: 'agent_run',
    category: 'agent',
    label: 'סוכנים מתוזמנים',
    description: 'פלט של סוכני ABC שרצים לפי לוח זמנים — שעות נקבעות במסך הסוכנים',
    availableChannels: ALL_CHANNELS,
    schedulable: false,
  },
  {
    id: 'whatsapp_fomo',
    category: 'whatsapp',
    label: 'התראת FOMO',
    description: 'ריבוי הודעות בקבוצה בזמן קצר — נשלח ל-WhatsApp; כאן שולטים בפוש',
    availableChannels: PUSH_ONLY,
    schedulable: false,
  },
  {
    id: 'whatsapp_keyword',
    category: 'whatsapp',
    label: 'מילת מפתח',
    description: 'זיהוי מילת מפתח בקבוצה — נשלח ל-WhatsApp; כאן שולטים בפוש',
    availableChannels: PUSH_ONLY,
    schedulable: false,
  },
  {
    id: 'whatsapp_group_summary',
    category: 'whatsapp',
    label: 'סיכום קבוצה',
    description: 'סיכום מתוזמן של קבוצות — נשלח ל-WhatsApp; כאן שולטים בפוש',
    availableChannels: PUSH_ONLY,
    schedulable: false,
  },
  {
    id: 'hugo_reply',
    category: 'hugo',
    label: 'תשובות הוגו',
    description: 'תשובה של הוגו ל-WhatsApp — כאן שולטים בהתראת הפוש למכשיר',
    availableChannels: PUSH_ONLY,
    schedulable: false,
  },
]

const TYPE_BY_ID = new Map(NOTIFICATION_TYPES.map((t) => [t.id, t]))

export interface ResolvedChannels {
  enabled: boolean
  whatsapp: boolean
  push: boolean
  telegram: boolean
}

export interface NotificationPrefItem extends NotificationTypeDef {
  enabled: boolean
  channels: { whatsapp: boolean; push: boolean; telegram: boolean }
  scheduleTimes: string[]
  agentId: string | null
  triggerMessage: string | null
}

export interface ChannelStatus {
  whatsapp: boolean
  telegram: boolean
  /** Web Push (PWA / Mac browser) — VAPID keys configured on server */
  push: boolean
  /** At least one Web Push subscription registered */
  webPushDevices: number
  /** At least one Expo push token registered (Helm APK) */
  expoPushDevices: number
}

function parseTimes(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String).filter((s) => /^\d{2}:\d{2}$/.test(s)) : []
  } catch {
    return []
  }
}

async function getRow(typeId: string) {
  const rows = await queryRows<typeof notificationPreferences.$inferSelect>(
    getDb()
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.typeId, typeId))
      .limit(1),
  )
  return rows[0] ?? null
}

/**
 * Resolve which channels a notification type should be delivered to.
 * No row (or unknown type) = enabled on every channel the type supports.
 */
export async function resolveNotificationChannels(typeId: string): Promise<ResolvedChannels> {
  const def = TYPE_BY_ID.get(typeId)
  const supports = (ch: NotificationChannel) => !def || def.availableChannels.includes(ch)

  try {
    const row = await getRow(typeId)
    if (!row) {
      return {
        enabled: true,
        whatsapp: supports('whatsapp'),
        push: supports('push'),
        telegram: supports('telegram'),
      }
    }
    return {
      enabled: !!row.enabled,
      whatsapp: supports('whatsapp') && !!row.channelWhatsapp,
      push: supports('push') && !!row.channelPush,
      telegram: supports('telegram') && !!row.channelTelegram,
    }
  } catch (err) {
    console.warn('[notification-preferences] resolve failed, defaulting to all channels:', err)
    return {
      enabled: true,
      whatsapp: supports('whatsapp'),
      push: supports('push'),
      telegram: supports('telegram'),
    }
  }
}

/** Read enabled + schedule config for a schedulable type. */
export async function getSchedulablePreference(
  typeId: string,
): Promise<{ enabled: boolean; scheduleTimes: string[]; lastSentAt: string | null }> {
  const def = TYPE_BY_ID.get(typeId)
  const fallbackTimes = def?.defaultTime ? [def.defaultTime] : []
  try {
    const row = await getRow(typeId)
    if (!row) return { enabled: true, scheduleTimes: fallbackTimes, lastSentAt: null }
    const times = parseTimes(row.scheduleTimes)
    return {
      enabled: !!row.enabled,
      scheduleTimes: times.length > 0 ? times : fallbackTimes,
      lastSentAt: row.lastSentAt ?? null,
    }
  } catch (err) {
    console.warn('[notification-preferences] getSchedulable failed:', err)
    return { enabled: true, scheduleTimes: fallbackTimes, lastSentAt: null }
  }
}

/** Read agent routing for an event type. agentId null = use built-in template. */
export async function getNotificationRouting(
  typeId: string,
): Promise<{ agentId: string | null; triggerMessage: string | null }> {
  const def = TYPE_BY_ID.get(typeId)
  if (!def?.routable) return { agentId: null, triggerMessage: null }
  try {
    const row = await getRow(typeId)
    const agentId = row?.agentId?.trim() || null
    return { agentId, triggerMessage: row?.triggerMessage?.trim() || null }
  } catch (err) {
    console.warn('[notification-preferences] getRouting failed:', err)
    return { agentId: null, triggerMessage: null }
  }
}

/** Stamp last_sent_at for a schedulable type (creates the row if missing). */
export async function markNotificationSent(typeId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    const existing = await getRow(typeId)
    const db = getDb()
    if (existing) {
      await db
        .update(notificationPreferences)
        .set({ lastSentAt: now, updatedAt: now })
        .where(eq(notificationPreferences.typeId, typeId))
    } else {
      await db.insert(notificationPreferences).values({
        typeId,
        enabled: true,
        channelWhatsapp: true,
        channelPush: true,
        channelTelegram: true,
        scheduleTimes: null,
        lastSentAt: now,
        updatedAt: now,
      })
    }
  } catch (err) {
    console.warn('[notification-preferences] markSent failed:', err)
  }
}

/** Whether this type already fired for the given day + HH:MM slot in the timezone. */
export function wasNotificationSentInSlot(
  lastSentAt: string | null | undefined,
  slot: string,
  timezone: string,
): boolean {
  if (!lastSentAt) return false
  try {
    const sentDate = new Date(lastSentAt)
    const sentSlot = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(sentDate)
    const sentDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(sentDate)

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    return sentDay === today && sentSlot === slot
  } catch {
    return false
  }
}

/** Full catalog merged with stored preferences for the settings UI. */
export async function listNotificationPreferences(): Promise<NotificationPrefItem[]> {
  const rows = await queryRows<typeof notificationPreferences.$inferSelect>(
    getDb().select().from(notificationPreferences),
  )
  const byId = new Map(rows.map((r) => [r.typeId, r]))

  return NOTIFICATION_TYPES.map((def) => {
    const row = byId.get(def.id)
    const times = parseTimes(row?.scheduleTimes)
    return {
      ...def,
      enabled: row ? !!row.enabled : true,
      channels: {
        whatsapp: def.availableChannels.includes('whatsapp') && (row ? !!row.channelWhatsapp : true),
        push: def.availableChannels.includes('push') && (row ? !!row.channelPush : true),
        telegram: def.availableChannels.includes('telegram') && (row ? !!row.channelTelegram : true),
      },
      scheduleTimes:
        times.length > 0 ? times : def.defaultTime ? [def.defaultTime] : [],
      agentId: row?.agentId?.trim() || null,
      triggerMessage: row?.triggerMessage?.trim() || null,
    }
  })
}

export interface UpsertPreferenceInput {
  typeId: string
  enabled?: boolean
  channels?: { whatsapp?: boolean; push?: boolean; telegram?: boolean }
  scheduleTimes?: string[]
  agentId?: string | null
  triggerMessage?: string | null
}

/** Create or update a single preference. Returns the merged catalog item. */
export async function upsertNotificationPreference(
  input: UpsertPreferenceInput,
): Promise<NotificationPrefItem> {
  const def = TYPE_BY_ID.get(input.typeId)
  if (!def) throw new Error(`Unknown notification type: ${input.typeId}`)
  if (input.scheduleTimes && !def.schedulable) {
    throw new Error('סוג התראה זה אינו תומך בקביעת שעה')
  }
  if (input.agentId && !def.routable) {
    throw new Error('סוג התראה זה אינו תומך בניתוב לסוכן')
  }

  const db = getDb()
  const now = new Date().toISOString()
  const prev = await getRow(input.typeId)

  const scheduleTimes =
    input.scheduleTimes !== undefined
      ? input.scheduleTimes
      : prev
        ? parseTimes(prev.scheduleTimes)
        : def.defaultTime
          ? [def.defaultTime]
          : []

  const agentId =
    input.agentId !== undefined ? (input.agentId?.trim() || null) : (prev?.agentId ?? null)
  const triggerMessage =
    input.triggerMessage !== undefined
      ? (input.triggerMessage?.trim() || null)
      : (prev?.triggerMessage ?? null)

  const row = {
    typeId: input.typeId,
    enabled: input.enabled ?? (prev ? !!prev.enabled : true),
    channelWhatsapp: input.channels?.whatsapp ?? (prev ? !!prev.channelWhatsapp : true),
    channelPush: input.channels?.push ?? (prev ? !!prev.channelPush : true),
    channelTelegram: input.channels?.telegram ?? (prev ? !!prev.channelTelegram : true),
    scheduleTimes: scheduleTimes.length > 0 ? JSON.stringify(scheduleTimes) : null,
    lastSentAt: prev?.lastSentAt ?? null,
    agentId,
    triggerMessage,
    updatedAt: now,
  }

  if (prev) {
    await db
      .update(notificationPreferences)
      .set(row)
      .where(eq(notificationPreferences.typeId, input.typeId))
  } else {
    await db.insert(notificationPreferences).values(row)
  }

  return {
    ...def,
    enabled: row.enabled,
    channels: {
      whatsapp: def.availableChannels.includes('whatsapp') && row.channelWhatsapp,
      push: def.availableChannels.includes('push') && row.channelPush,
      telegram: def.availableChannels.includes('telegram') && row.channelTelegram,
    },
    scheduleTimes,
    agentId,
    triggerMessage,
  }
}

/** Drop all stored preferences so every type reverts to its default. */
export async function resetNotificationPreferences(): Promise<number> {
  const rows = await queryRows<{ typeId: string }>(
    getDb().select({ typeId: notificationPreferences.typeId }).from(notificationPreferences),
  )
  await getDb().delete(notificationPreferences)
  return rows.length
}

/** Server-side connectivity of each delivery channel. */
export async function getChannelStatus(): Promise<ChannelStatus> {
  const db = getDb()
  const [webSubs, expoRows] = await Promise.all([
    db.select().from(pushSubscriptions).all(),
    db.select().from(expoPushTokens).all(),
  ])
  return {
    whatsapp: isBridgeConfigured(),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_CHAT_ID),
    push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    webPushDevices: webSubs.length,
    expoPushDevices: expoRows.length,
  }
}
