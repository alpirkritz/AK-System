#!/usr/bin/env node
import Database from 'better-sqlite3'

const dbPath = process.env.DATABASE_PATH || '/data/ak_system.sqlite'
const db = new Database(dbPath)

console.log('Fixing WhatsApp digest configuration...')

// Clear individual summary times for all groups
const clearResult = db.prepare(`
  UPDATE whatsapp_groups 
  SET summary_times = '[]', 
      updated_at = datetime('now')
  WHERE summary_times IS NOT NULL 
    AND summary_times != '[]'
`).run()

console.log(`✓ Cleared ${clearResult.changes} group summary times`)

// Ensure daily digest is enabled at 20:30
db.prepare(`
  INSERT OR REPLACE INTO notification_preferences (
    type_id, 
    enabled, 
    schedule_times, 
    channel_whatsapp, 
    channel_push, 
    channel_telegram, 
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`).run('whatsapp_daily_digest', 1, '["20:30"]', 1, 1, 1)

console.log('✓ Daily digest enabled at 20:30')

// Verify
const groupsWithTimes = db.prepare(`
  SELECT jid, name, summary_times 
  FROM whatsapp_groups 
  WHERE summary_times IS NOT NULL 
    AND summary_times != '[]'
`).all()

const digestConfig = db.prepare(`
  SELECT type_id, enabled, schedule_times, last_sent_at 
  FROM notification_preferences 
  WHERE type_id = 'whatsapp_daily_digest'
`).get()

console.log('\n── Verification ──')
console.log('Groups with individual summaries:', groupsWithTimes.length, '(should be 0)')
if (groupsWithTimes.length > 0) {
  console.log(groupsWithTimes)
}
console.log('Daily digest config:', digestConfig)

db.close()
console.log('\n✓ Done')
