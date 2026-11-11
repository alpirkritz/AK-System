# AK WhatsApp Bridge

Personal WhatsApp Connection Manager (Baileys Linked Device) for AK System.

## Quick start

```bash
cp .env.example .env
# Edit BRIDGE_SECRET

pnpm install
pnpm dev
```

Open http://localhost:3001/ and scan the QR code (WhatsApp → Linked Devices).

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | QR pairing page |
| GET | `/status` | — | Connection status, self Jid, capture-list sizes |
| GET | `/qr` | — | QR as data URL JSON |
| POST | `/send` | Bearer | `{ "text": "...", "to?": "jid" }` |
| GET | `/groups` | Bearer | Watched groups + buffer counts |
| POST | `/groups/summarize` | Bearer | `{ "groupJid": "..." }` |
| POST | `/groups/summarize-cluster` | Bearer | `{ "clusterName": "...", "groupJids": ["..."] }` — one briefing for an opt-in label cluster. `/groups/summarize-all` stays per-group. |
| POST | `/groups/summarize-all` | Bearer | Summarize all watched groups (per-group; clustering is decided by AK cron/tRPC) |

## Deploy

Run on a VM or Railway **with persistent volumes** mounted at `AUTH_STATE_PATH` (e.g. `/data/auth`)
and `BRIDGE_CONFIG_PATH` (e.g. `/data/config`). They must be separate: clearing the auth state to
force a new QR is routine, and it must not delete the group/DM capture lists.

See [`S_Skills/wf_whatsapp_bridge.md`](../../S_Skills/wf_whatsapp_bridge.md) for full workflow and compliance checklist.
