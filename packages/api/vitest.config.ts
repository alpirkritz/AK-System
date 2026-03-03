import path from 'node:path'
import { defineConfig } from 'vitest/config'

const testDbPath = path.join(__dirname, 'test-data', 'ak_system.sqlite')

export default defineConfig({
  test: {
    env: {
      DATABASE_PATH: testDbPath,
    },
    globals: true,
    pool: 'forks',
    environment: 'node',
  },
  resolve: {
    alias: {
      '@ak-system/database': path.join(__dirname, '../database/src/index.ts'),
    },
  },
})
