import { type NextRequest, NextResponse } from 'next/server'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { sendTelegramMessage } from '@/lib/telegram-bot'

/**
 * Cron: Task reminder poller (run every 1 min per Second Brain spec).
 * Finds tasks that are due today or overdue and not done, sends a digest to Telegram.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runTaskReminder(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runTaskReminder(request)
}

async function runTaskReminder(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  const hasTelegram = process.env.TELEGRAM_BOT_TOKEN && chatId

  try {
    const today = new Date().toISOString().split('T')[0]
    const db = getDb()
    const ctx = await createContext({ db })
    const caller = appRouter.createCaller(ctx)
    const allTasks = await caller.tasks.list()
    const dueOrOverdue = allTasks.filter(
      (t) => !t.done && t.dueDate && t.dueDate <= today
    )
    if (dueOrOverdue.length === 0) {
      return NextResponse.json({ ok: true, reminded: 0 })
    }

    const lines = ['⏰ תזכורת משימות (עבר מועד / להיום):']
    for (const t of dueOrOverdue.slice(0, 15)) {
      lines.push(`• [${t.priority}] ${t.title}${t.dueDate ? ` (${t.dueDate})` : ''}`)
    }
    const text = lines.join('\n').slice(0, 4000)

    if (hasTelegram) {
      await sendTelegramMessage(Number(chatId!), text)
    }
    return NextResponse.json({ ok: true, reminded: dueOrOverdue.length, sent: !!hasTelegram })
  } catch (err) {
    console.error('[cron/task-reminder]', err)
    const msg = err instanceof Error ? err.message : 'Task reminder failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
