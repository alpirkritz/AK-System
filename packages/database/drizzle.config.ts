import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH || './data/ak_system.sqlite',
  },
  // google_connections is created by the raw bootstrap in src/index.ts, not by the
  // Drizzle schema. Without this filter, push treats it as an orphan and asks
  // whether each newly added table is a rename of it, which blocks `pnpm test`.
  tablesFilter: ['!google_connections'],
})
