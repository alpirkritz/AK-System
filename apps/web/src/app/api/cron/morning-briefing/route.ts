import { type NextRequest, NextResponse } from 'next/server'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { sendTelegramMessage } from '@/lib/telegram-bot'
import { saveChatMessage } from '@/lib/conversation-engine'

/**
 * Cron: Morning calendar briefing (run at 07:00 Israel time).
 * Sends today's schedule (events + due tasks) to Telegram when configured.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runMorningBriefing(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runMorningBriefing(request)
}

async function runMorningBriefing(request: NextRequest): Promise<NextResponse> {
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
    const db = getDb()
    const ctx = await createContext({ db })
    const caller = appRouter.createCaller(ctx)
    const today = new Date().toISOString().split('T')[0]
    const [events, allTasks] = await Promise.all([
      caller.calendar.events({ startDate: today, endDate: today }),
      caller.tasks.list(),
    ])
    const dueTasks = allTasks.filter((t) => !t.done && t.dueDate === today)

    const lines: string[] = ['📅 סיכום הבוקר – ' + today]
    if (events.length === 0 && dueTasks.length === 0) {
      lines.push('אין אירועים או משימות מועדות להיום.')
    } else {
      if (events.length > 0) {
        lines.push('', 'אירועים:')
        for (const e of events) {
          const time = e.start.includes('T') ? e.start.slice(11, 16) : 'כל היום'
          lines.push(`• ${time} – ${e.title}`)
        }
      }
      if (dueTasks.length > 0) {
        lines.push('', 'משימות להיום:')
        for (const t of dueTasks) {
          lines.push(`• [${t.priority}] ${t.title}`)
        }
      }
    }
    const text = lines.join('\n').slice(0, 4000)

    await saveChatMessage('assistant', text, 'cron')
    if (hasTelegram) {
      await sendTelegramMessage(Number(chatId), text)
    }
    return NextResponse.json({ ok: true, events: events.length, dueTasks: dueTasks.length, sent: !!hasTelegram })
  } catch (err) {
    console.error('[cron/morning-briefing]', err)
    const msg = err instanceof Error ? err.message : 'Morning briefing failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
