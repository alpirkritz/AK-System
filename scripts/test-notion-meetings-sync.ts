/**
 * Test script to manually trigger Notion meetings sync
 */
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local from apps/web
config({ path: resolve(process.cwd(), 'apps/web/.env.local') })

import { syncNotionGraph } from '../packages/api/src/services/notion-graph-sync'

console.log('🔄 Starting Notion meetings sync...')
console.log('')

// First test: check if config is loaded
import { resolveDatabases } from '../packages/api/src/services/notion-tasks-sync'
const meetings = resolveDatabases('meetings')
console.log(`✓ Found ${meetings.length} meeting databases:`)
meetings.forEach(db => console.log(`  • ${db.name} (${db.accountLabel})`))
console.log('')

async function main() {
  try {
    console.log('⏳ Calling syncNotionGraph (90-day window)...')
    const result = await syncNotionGraph({ 
      windowDays: 90,
      dryRun: false, 
      scope: 'meetings' 
    })
    
    console.log('✅ Sync completed successfully!')
    console.log('')
    console.log(`📊 Results:`)
    console.log(`   • Meetings upserted: ${result.meetingsUpserted}`)
    console.log(`   • Notes upserted: ${result.notesUpserted}`)
    console.log(`   • Notes pruned: ${result.notesPruned}`)
    console.log(`   • Links rewritten: ${result.linksRewritten}`)
    
    if (result.errors.length > 0) {
      console.log('')
      console.log(`⚠️  ${result.errors.length} errors:`)
      result.errors.forEach(err => console.log(`   • ${err}`))
    }
  } catch (err) {
    console.error('❌ Sync failed:', err)
    process.exit(1)
  }
}

main()
