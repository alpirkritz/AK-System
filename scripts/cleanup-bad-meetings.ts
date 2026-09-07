/**
 * Cleanup script for bad meeting records:
 * 1. Meetings with timestamp titles (e.g., "2026-08-11T10:26:00.000+03:00")
 * 2. Notion-sourced meetings without calendar events (orphaned)
 */

import { getDb, meetings, eq, like, and, isNull } from '@ak-system/database'

async function cleanupBadMeetings() {
  const db = getDb()

  console.log('🔍 Finding bad meetings...\n')

  // 1. Find meetings with timestamp titles (start with "20" followed by digits and dashes/colons)
  const timestampPattern = '20__-__-__T%'
  const timestampMeetings = await db
    .select()
    .from(meetings)
    .where(like(meetings.title, timestampPattern))

  console.log(`Found ${timestampMeetings.length} meetings with timestamp titles:`)
  timestampMeetings.forEach((m) => {
    console.log(`  - ${m.id}: "${m.title}" (${m.date}) [source: ${m.source}]`)
  })

  // 2. Find Notion-sourced meetings without calendar events (potentially orphaned)
  const notionOrphans = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.source, 'calendar'), // Marked as calendar but...
        isNull(meetings.calendarEventId) // ...no actual calendar event
      )
    )

  console.log(`\nFound ${notionOrphans.length} potential Notion orphans (no calendarEventId):`)
  notionOrphans.slice(0, 20).forEach((m) => {
    console.log(`  - ${m.id}: "${m.title}" (${m.date})`)
  })
  if (notionOrphans.length > 20) {
    console.log(`  ... and ${notionOrphans.length - 20} more`)
  }

  // Ask for confirmation
  console.log('\n⚠️  This will delete:')
  console.log(`   • ${timestampMeetings.length} meetings with timestamp titles`)
  console.log(`   • ${notionOrphans.length} Notion orphans without calendar events`)
  console.log('\nType "yes" to proceed, or anything else to cancel:')

  // Read from stdin
  const readline = require('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  rl.question('', async (answer: string) => {
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('\n❌ Cancelled.')
      process.exit(0)
    }

    console.log('\n🗑️  Deleting...')

    // Delete timestamp meetings
    let deleted = 0
    for (const m of timestampMeetings) {
      await db.delete(meetings).where(eq(meetings.id, m.id))
      deleted++
    }
    console.log(`✓ Deleted ${deleted} timestamp meetings`)

    // Delete Notion orphans
    deleted = 0
    for (const m of notionOrphans) {
      await db.delete(meetings).where(eq(meetings.id, m.id))
      deleted++
    }
    console.log(`✓ Deleted ${deleted} Notion orphans`)

    console.log('\n✅ Done! Refresh your browser to see the updated meetings list.')
    process.exit(0)
  })
}

cleanupBadMeetings().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
