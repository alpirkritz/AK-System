import { getDb, meetings, like } from '@ak-system/database'

async function deleteTimestampMeetings() {
  const db = getDb()

  console.log('🗑️  Deleting meetings with timestamp titles...')

  // Delete meetings with timestamp titles (e.g., "2026-08-11T10:26:00.000+03:00")
  const timestampPattern = '20__-__-__T%'
  
  const result = await db.delete(meetings).where(like(meetings.title, timestampPattern))
  
  const count = result ? (result as any).changes || 0 : 0
  console.log(`✓ Deleted ${count} meetings`)
  
  console.log('\n✅ Done! Now trigger a Notion sync to recreate them with correct Subject titles.')
  console.log('   Go to http://localhost:3000/meetings and click "סנכרן סיכומי Notion"')
}

deleteTimestampMeetings().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
