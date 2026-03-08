# AK System – production image (monorepo: Next.js + SQLite)
# Build: docker build -t ak-system .
# Run:   docker run -p 3000:3000 -v ./data:/data -e DATABASE_PATH=/data/ak_system.sqlite --env-file apps/web/.env.local ak-system

FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @ak-system/web build

WORKDIR /app/apps/web

EXPOSE 3000

ENV DATABASE_PATH=/data/ak_system.sqlite
ENV NODE_ENV=production
ENV PORT=3000

CMD ["pnpm", "start"]
