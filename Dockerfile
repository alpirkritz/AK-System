# AK System – production image (monorepo: Next.js + SQLite)
# Build: docker build -t ak-system .
# Run:   docker run -p 3000:3000 -v ./data:/data -e DATABASE_PATH=/data/ak_system.sqlite --env-file apps/web/.env.local ak-system

FROM node:22-bookworm-slim

# Chromium shared libs for israeli-bank-scrapers / Puppeteer (bookworm-slim is bare).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @ak-system/web build

EXPOSE 3000

ENV DATABASE_PATH=/data/ak_system.sqlite
ENV NODE_ENV=production
ENV PORT=3000
ENV WS_NO_BUFFER_UTIL=1
ENV WS_NO_UTF_8_VALIDATE=1

# Run db:push against the mounted volume, then start Next.js.
CMD ["bash", "scripts/production-start.sh"]
