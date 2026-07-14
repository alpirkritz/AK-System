# Spec: Fix production JSON Parse Error from middleware API redirect

**Slug:** `middleware-api-json-parse-fix`  
**Type:** bugfix  
**Stack:** next-trpc-monorepo  
**Priority:** P0 (production break)

## Problem

After the 2026-07-14 EC2 deploy, the app returns **JSON Parse Error** for API/tRPC calls.

Root cause: uncommitted `middleware.ts` changes (mobile-dev CORS) added `/api/:path*` to the matcher. In production, unauthenticated `/api/*` requests were **HTML-redirected to `/login`**, so clients expecting JSON (web tRPC, mobile, cron, WhatsApp bridge) failed to parse the response.

## Goal

Restore: API routes never get HTML login redirects in production. They keep enforcing their own auth.

## Acceptance criteria

1. Unauthenticated `GET /api/trpc/...` returns JSON (e.g. UNAUTHORIZED) — not `307` → `/login`.
2. Bearer-authenticated `/api/whatsapp/*` and `/api/cron/*` reach the route handlers.
3. Dev CORS for Expo (`NODE_ENV=development`) still works on `/api`.
4. Page routes without a session still redirect to `/login`.

## Implementation

In `apps/web/src/middleware.ts`, after the production skip-auth escape hatch and before the session cookie check: if `pathname.startsWith('/api')`, return `NextResponse.next()`.

## Out of scope

Mobile-dev login feature itself (separate uncommitted work).
