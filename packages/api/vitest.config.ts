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
    // Every suite shares one SQLite file and wipes tables in beforeEach —
    // running files in parallel makes them clobber each other.
    fileParallelism: false,
    environment: 'node',
    include: ['src/**/*.test.ts', '../../scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@ak-system/database': path.join(__dirname, '../database/src/index.ts'),
    },
  },
})
