import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '../mobile/lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
})
