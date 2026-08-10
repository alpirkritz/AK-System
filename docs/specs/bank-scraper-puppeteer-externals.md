# Spec: Bank scraper Puppeteer externals (e.mask)

## Goal

Fix production bank sync throwing `e.mask is not a function (UNKNOWN_ERROR)` on EC2 after Chromium libs were installed. Root cause: Next.js webpack bundles/interferes with Puppeteer's `ws` WebSocket stack (`bufferUtil.mask`), so `puppeteer.launch` fails during scraper `initialize()` (outside the library's login try/catch).

## User stories

- As Alpir, I want Hapoalim and Otsar HaHayal sync to get past browser launch on EC2, so I can see real bank/auth outcomes instead of `e.mask`.
- As the deployer, I want Puppeteer kept as a Node external, so Next never webpacks `ws`/native optional deps.

## Acceptance criteria

- Given production Next server on EC2, When bank sync runs, Then `israeli-bank-scrapers` / `puppeteer` / `puppeteer-core` load via Node `require` (not webpack bundle).
- Given sync after redeploy, When Chromium launches, Then error is not `e.mask is not a function`.
- Given invalid credentials, When scrape runs, Then a normal scraper result (TIMEOUT / INVALID_PASSWORD / etc.) is stored — not UNKNOWN_ERROR from a thrown CDP/ws failure.
- Optional belt-and-suspenders: `WS_NO_BUFFER_UTIL=1` and `WS_NO_UTF_8_VALIDATE=1` in the runtime image env so `ws` skips optional natives.

## Data model

None.

## tRPC API

None.

## UI surface

None.

## Implementation notes

1. `apps/web/next.config.js`: add `israeli-bank-scrapers`, `puppeteer`, `puppeteer-core` (and `ws` if needed) to `experimental.serverComponentsExternalPackages` and to the server webpack `externals` commonjs list.
2. `deploy/Dockerfile.runtime` + `docker-compose` / `production.env.example`: set `WS_NO_BUFFER_UTIL=1` and `WS_NO_UTF_8_VALIDATE=1`.
3. Rebuild + `pnpm deploy:ec2` required (Next bundle change).

## Out of scope

- Fixing bank 2FA / new portal URL matching beyond what the upstream library already does.
- Installing native `bufferutil` build toolchain in the image.

## Open questions

None.
