import { defineConfig } from 'drizzle-kit'

const usePostgres = Boolean(process.env.DATABASE_URL)

export default defineConfig(
  usePostgres
    ? {
        schema: './src/schema.pg.ts',
        out: './drizzle',
        dialect: 'postgresql',
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      }
    : {
        schema: './src/schema.ts',
        out: './drizzle',
        dialect: 'sqlite',
        dbCredentials: {
          url: process.env.DATABASE_PATH || './data/ak_system.sqlite',
        },
      },
)
