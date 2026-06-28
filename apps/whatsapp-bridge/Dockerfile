FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

COPY package.json pnpm-lock.yaml* ./
COPY apps/whatsapp-bridge/package.json ./apps/whatsapp-bridge/

RUN pnpm install --filter @ak-system/whatsapp-bridge --frozen-lockfile || \
    pnpm --dir apps/whatsapp-bridge install

COPY apps/whatsapp-bridge ./apps/whatsapp-bridge

WORKDIR /app/apps/whatsapp-bridge

RUN pnpm build

ENV PORT=3001
ENV AUTH_STATE_PATH=/data/auth

EXPOSE 3001

CMD ["pnpm", "start"]
