# WhatsApp "connect" button with in-app QR

## Goal
Re-pair the WhatsApp bridge from Settings → WhatsApp → חיבור without SSH. One click shows a QR in the page; scan it from the phone and the bridge is connected.

## User stories
- When the bridge shows "לא מחובר", I press **התחבר ל-WhatsApp**, a QR appears, I scan it (Linked devices), and the card flips to "מחובר".
- If WhatsApp logged the device out, the button also clears the stale auth state so a fresh QR is produced.

## Acceptance criteria
1. Button visible in the connection card while `connected === false`.
2. Click → bridge restarts its socket (no auth wipe unless last error is "Logged out") and returns a QR within ~15s.
3. QR re-polled every 2.5s (it rotates); on `connected` the QR closes, status refetches, message "WhatsApp מחובר".
4. Auth-gated end to end (tRPC protectedProcedure → bridge `requireAuth`). No port 3001 exposure needed.

## Data model
None.

## API
- Bridge: `POST /pair` (auth) → `{ connected, qr: dataUrl|null }`; existing `GET /qr` used for polling.
- tRPC: `whatsapp.connection.pair` (mutation), `whatsapp.connection.qr` (query).

## UI
`apps/web/src/app/settings/whatsapp/page.tsx`, connection tab. Uses `.btn`/`.card`, RTL, dark theme; QR on white tile for scan contrast.

## Out of scope
Manual "reset auth" button, auto-restart on "QR attempts ended".

## Open questions
None.
