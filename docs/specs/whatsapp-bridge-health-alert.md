# WhatsApp bridge health alert

## Goal
Alert the owner when WhatsApp messages stop reaching AK System — including when the bridge claims `connected: true` but every message fails to decrypt (the Nov 12–14 2026 "Bad MAC" outage went unnoticed for two days).

## User stories
- As the owner, I get a push/Telegram alert within a few hours when WhatsApp ingestion stops, with what's wrong and how to re-pair.
- I get one alert per incident (plus a reminder every 12h), and a "back online" message when it recovers.

## Acceptance criteria
- Cron `/api/cron/whatsapp-health` every 15 min (`deploy/crontab.example`).
- Unhealthy when: the bridge `/status` is unreachable, or `connected: false`, or no group/DM message has been stored for ≥ 5h, counting from the later of the last message and 07:00 local (night silence never alerts).
- Delivery: in-app notification (type `system`, links `/settings/whatsapp`), mobile + browser push, Telegram. Never via WhatsApp.
- New notification type `whatsapp_bridge_health` (push/telegram) so the user can mute it or pick channels in notification settings.
- Incident state = `notification_preferences.last_sent_at` for that type (set on alert/remind, cleared on recovery).

## Data model
No schema changes.

## tRPC API
None. Service `packages/api/src/services/whatsapp-health.ts`.

## Out of scope
Auto re-pairing; bridge-side decrypt-failure counters (possible follow-up for faster detection).
