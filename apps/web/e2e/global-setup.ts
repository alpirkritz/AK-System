import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

export default function globalSetup() {
  const webDir = path.join(__dirname, '..')
  const dataDir = path.join(webDir, 'data')
  const e2eDb = path.join(dataDir, 'e2e.sqlite')

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // Remove existing E2E DB so every run starts with empty data (avoids strict mode from duplicate rows)
  if (fs.existsSync(e2eDb)) {
    fs.unlinkSync(e2eDb)
  }

  const dbPackageDir = path.join(webDir, '../../packages/database')
  execSync('pnpm run push', {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_PATH: e2eDb },
    stdio: 'inherit',
  })
}
