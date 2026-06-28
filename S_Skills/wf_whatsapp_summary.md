# Workflow: WhatsApp Group Summary

> **Workflow ID:** `wf_whatsapp_summary`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Depends on:** `wf_whatsapp_bridge.md` Stage 3

---

## Purpose

Generate AI summaries of watched WhatsApp group conversations and deliver them to the user's Message Yourself chat (Tachless-lite, single-user).

---

## Prerequisites

- [ ] WhatsApp bridge connected (`wf_whatsapp_bridge` Stage 1 complete)
- [ ] Groups configured via `/settings/whatsapp` (follow + summary times) or legacy `WATCH_GROUP_JIDS` env
- [ ] AK System `WHATSAPP_BRIDGE_URL` configured
- [ ] Compliance checklist in `wf_whatsapp_bridge.md` — group listening approved

---

## Logic Map

```
[Group message in WATCH_GROUP_JIDS]
        │
        ▼
┌──────────────────────────┐
│  Buffer in bridge        │  In-memory + optional flush to AK
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  POST /groups/summarize  │  Manual or cron trigger
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  AK group-summary API    │  Gemini summarizes buffered messages
└──────────────────────────┘
        │
        ▼
[Push summary to Message Yourself via bridge /send]
```

---

## Stage 1: Configure Groups

1. Open AK **Settings → WhatsApp** (`/settings/whatsapp`)
2. Click **Refresh from WhatsApp** — bridge `GET /groups/available`
3. Enable **follow** for target groups; assign labels and per-group summary times (or use label defaults)
4. Click **Sync rules to bridge** — pushes `POST /config/reload`
5. Confirm `GET /groups` on bridge lists enabled groups with message counts

Legacy: add JIDs to `WATCH_GROUP_JIDS` on bridge env (fallback only).

---

## Stage 2: Summarize

**Manual trigger:**

```bash
curl -X POST http://localhost:3001/groups/summarize \
  -H "Authorization: Bearer $BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"groupJid":"120363...@g.us"}'
```

**Automated (scheduled):** External cron every 15 min hits AK:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<domain>/api/cron/whatsapp-group-summary
```

Summarizes only groups whose `summaryTimes` (or label default) match current `HH:MM` in `TIMEZONE` (default `Asia/Jerusalem`).

---

## Stage 3: Review Output

1. Summary appears in Message Yourself on WhatsApp
2. Same content logged in AK `chat_messages` with `source: whatsapp`
3. Human reviews before sharing summary outside personal use

---

## Compliance

- Summaries are for personal triage only
- Do not forward group content to third parties without participant consent
- Redact PII if summary is copied to `O_Output/` artifacts
