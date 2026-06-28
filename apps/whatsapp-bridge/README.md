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
| GET | `/status` | — | Connection status + self Jid |
| GET | `/qr` | — | QR as data URL JSON |
| POST | `/send` | Bearer | `{ "text": "...", "to?": "jid" }` |
| GET | `/groups` | Bearer | Watched groups + buffer counts |
| POST | `/groups/summarize` | Bearer | `{ "groupJid": "..." }` |
| POST | `/groups/summarize-all` | Bearer | Summarize all watched groups |

## Deploy

Run on a VM or Railway **with a persistent volume** mounted at `AUTH_STATE_PATH` (e.g. `/data/auth`).

See [`S_Skills/wf_whatsapp_bridge.md`](../../S_Skills/wf_whatsapp_bridge.md) for full workflow and compliance checklist.
