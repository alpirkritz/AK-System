# Spec: Bank scraper Chrome deps on EC2

## Goal

Make Bank Hapoalim (and other israeli-bank-scrapers) sync work on the production EC2 Docker image by installing Chromium shared libraries and passing Docker-safe Puppeteer launch args. Today sync fails with exit code 127 / missing `libglib-2.0.so.0`.

## User stories

- As Alpir, I want "סנכרן עכשיו" on a connected Hapoalim account to succeed on EC2, so that balances and transactions update without SSH debugging.
- As Alpir, I want the same fix to cover Otsar HaHayal / Visa Cal / Isracard, so that every provider works in production.
- As the deployer, I want Chrome system deps baked into the runtime image, so that a normal `pnpm deploy:ec2` is enough after this change.

## Acceptance criteria

- Given the production image built from `deploy/Dockerfile.runtime`, When Chromium is launched by the bank scraper, Then it finds `libglib-2.0.so.0` and related shared libs (no Code 127 / missing shared library).
- Given Docker/container runtime, When `realScrape` creates a scraper, Then Puppeteer receives at least `--no-sandbox`, `--disable-setuid-sandbox`, and `--disable-dev-shm-usage`.
- Given a valid Hapoalim connection on EC2 after redeploy, When Alpir clicks "סנכרן עכשיו", Then sync status is not the Chromium launch error; success or a bank-side/auth error only.
- Given `node:22-bookworm-slim` stays the base image, When image build runs, Then apt installs the Puppeteer/Chrome dependency set in one layer (no switch to full `bookworm` unless slim + deps fails).
- Given local Mac / Vitest, When bank sync tests run with injected `bankScrape`, Then behavior is unchanged (no real Chromium required in CI).

## Data model

No schema changes. `schema.ts` / `schema.pg.ts` untouched.

## tRPC API

No new procedures. Existing `finance.bankConnections.sync` / create-and-sync paths keep the same shapes; only the underlying `realScrape` launch options and the Docker image change.

## UI surface

No UI changes. The red error banner on `/finance` Accounts already surfaces `errorMessage` from the scraper; after the fix that message should no longer be the Chromium shared-library failure.

## Implementation notes (for Dev)

1. **`deploy/Dockerfile.runtime`** (and root `Dockerfile` for parity): after base image, `apt-get update && apt-get install -y --no-install-recommends` the standard Puppeteer Debian deps (must include `libglib2.0-0`, plus nss/atk/cups/drm/gbm/gtk/pango/x11/fonts packages commonly listed in [Puppeteer troubleshooting](https://pptr.dev/troubleshooting)), then `rm -rf /var/lib/apt/lists/*`.
2. **`packages/api/src/services/bank-sync-service.ts`**: pass Docker-safe `args` into `createScraper({ ... })`. Prefer always-on args (harmless on Mac) over env gating, unless a conflict appears.
3. Optional: short note in `docs/deploy/ec2-production.md` that bank sync needs Chromium system deps in the image (already handled by Dockerfile).
4. Image size will grow; acceptable for this feature. Keep scrapers sequential (existing rule for 1 GB EC2).

## Out of scope

- Switching to Browserless / remote Chrome / a separate scraper worker service.
- Increasing EC2 instance size.
- Changing credential encryption, providers list, or sync schedule.
- Fixing bank-side login / 2FA / CAPTCHA failures (only the Chromium launch failure).
- Installing Google Chrome `.deb` instead of Puppeteer's bundled Chromium (keep current download path unless deps alone are insufficient).

## Open questions

None — proceed with slim image + apt deps + launch args.
