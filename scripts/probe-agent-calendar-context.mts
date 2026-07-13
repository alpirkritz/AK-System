import { getAgentCalendarContext, formatAgentCalendarContextForPrompt } from '../packages/api/src/services/agent-calendar-context.ts'

const ctx = await getAgentCalendarContext()
const dt = ctx.events.filter((e) => /dragontail/i.test(e.calendarName || ''))
const timed = ctx.events.filter((e) => !e.isAllDay)
console.log(JSON.stringify({ today: ctx.today, total: ctx.events.length, timed: timed.length, dragontail: dt.length, errors: ctx.errors }, null, 2))
console.log('--- prompt excerpt ---')
console.log(formatAgentCalendarContextForPrompt(ctx).split('\n').slice(0, 30).join('\n'))
