/**
 * Debug script to check Notion configuration
 */
import { resolveDatabases } from '../packages/api/src/services/notion-tasks-sync'

console.log('🔍 Checking Notion configuration...')
console.log('')

console.log('ENV NOTION_ACCOUNTS length:', process.env.NOTION_ACCOUNTS?.length || 0)
console.log('')

const types = ['meetings', 'meeting_notes', 'projects', 'companies', 'people', 'tasks'] as const

for (const type of types) {
  const dbs = resolveDatabases(type)
  console.log(`📂 ${type}: ${dbs.length} databases`)
  dbs.forEach(db => {
    console.log(`   • ${db.name} (${db.accountLabel})`)
  })
}
