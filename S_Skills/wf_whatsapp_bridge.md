# Workflow: WhatsApp Bridge

> **Workflow ID:** `wf_whatsapp_bridge`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Deploy target:** VM or Railway with persistent volume (not serverless)

---

## Purpose

Step-by-step map for operating the personal WhatsApp Connection Manager (`apps/whatsapp-bridge`) and its integration with AK System. Self-chat first; group listening in `wf_whatsapp_summary.md`.

---

## Prerequisites

- [ ] `C_Core/brand_dna_and_compliance.md` reviewed (see Compliance Checklist below)
- [ ] Personal WhatsApp number with active SIM
- [ ] Phone available for QR / Linked Device pairing
- [ ] Persistent disk for Baileys auth state (`AUTH_STATE_PATH`)
- [ ] HTTPS URL for AK System webhook (production)

---

## Environment Variables

### WhatsApp Bridge (`apps/whatsapp-bridge/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Default `3001` |
| `AUTH_STATE_PATH` | Yes | Persistent path, e.g. `/data/auth` |
| `BRIDGE_SECRET` | Yes | Shared secret with AK System |
| `AK_WEBHOOK_URL` | Phase 2+ | e.g. `https://your-app/api/whatsapp/webhook` |
| `SELF_JID` | No | Auto-detected after connect; override if needed |
| `ALLOWED_JIDS` | No | Comma-separated allowlist; defaults to self JID |
| `WATCH_GROUP_JIDS` | Phase 3 | Comma-separated group JIDs to buffer |
| `DEVICE_NAME` | No | Linked Device name in WhatsApp (default: `AK System`) |

### AK System (`apps/web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `WHATSAPP_BRIDGE_URL` | Phase 2+ | e.g. `http://localhost:3001` or internal URL |
| `WHATSAPP_BRIDGE_SECRET` | Phase 2+ | Same as `BRIDGE_SECRET` |
| `WHATSAPP_ALLOWED_JID` | No | Restrict inbound to this JID (self-chat) |

---

## Logic Map Overview

```
[Pair: QR scan on /]
        │
        ▼
┌──────────────────────────┐
│  STAGE 1: CONNECT        │  Baileys Linked Device + auth persistence
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  STAGE 2: SELF CHAT      │  Inbound → AK webhook → Gemini → reply via /send
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  STAGE 3: GROUP WATCH     │  Buffer group msgs → summarize → push to self
└──────────────────────────┘
```

---

## Stage 1: Connect (Pairing)

**Objective:** Establish Baileys session as a Linked Device.

### Steps

1. Start bridge: `pnpm --filter @ak-system/whatsapp-bridge dev`
2. Open `http://localhost:3001/` — scan QR with WhatsApp → Linked Devices
3. Confirm `GET /status` returns `{ connected: true, selfJid: "..." }`
4. Copy `selfJid` to `WHATSAPP_ALLOWED_JID` in AK System if using explicit allowlist
5. Smoke test: `POST /send` with `{ "text": "בוקר טוב" }` — message appears in Message Yourself

### Rollback

- Delete `AUTH_STATE_PATH` contents and re-pair
- If logged out from phone: clear auth state and scan QR again

---

## Stage 2: AK Integration

**Objective:** Self-chat messages route through `conversation-engine`.

### Steps

1. Set `AK_WEBHOOK_URL` on bridge → AK `POST /api/whatsapp/webhook`
2. Set `WHATSAPP_BRIDGE_URL` + `WHATSAPP_BRIDGE_SECRET` on AK
3. Send a message to yourself on WhatsApp — expect Gemini reply
4. Verify cron jobs (morning briefing) also push to WhatsApp when bridge is configured

---

## Stage 3: Group Watch

**Objective:** Buffer watched group messages; periodic AI summary to self-chat.

See [`wf_whatsapp_summary.md`](wf_whatsapp_summary.md).

---

## Compliance Checklist

> Not legal advice. Confirm with human review before production or group listening.

- [ ] **ToS awareness:** Baileys uses unofficial WhatsApp Web protocol — violates WhatsApp ToS; account ban risk exists (lower for single-user personal use)
- [ ] **Scope:** Personal assistant on your own number only — not multi-tenant SaaS without Meta Business API migration
- [ ] **PII:** Group summaries may contain third-party data — do not export or share without consent
- [ ] **Group listening:** Inform group participants if summaries are generated from their messages (privacy expectation)
- [ ] **Secrets:** `BRIDGE_SECRET` never committed; auth state directory never in Git
- [ ] **Human in the loop:** AI replies and summaries are drafts — user reviews before acting
- [ ] **Logging:** Append bridge operations to `M_Memory/agents_daily_sync.md` on setup changes
- [ ] **Fallback:** Telegram channel remains available if WhatsApp session drops

---

## Escalation

Stop and ask the user when:

- WhatsApp account receives ban or forced logout repeatedly
- Group listening involves work/client groups without explicit approval
- Moving from personal use to external product (requires Meta Cloud API + legal review)
