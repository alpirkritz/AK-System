# WhatsApp Group Summary TLDR

> **Slug:** `whatsapp-group-summary-tldr`
> **Status:** Approved
> **Last Updated:** 2026-07-06

## Goal

When a WhatsApp group summary trigger fires (scheduled cron, Hugo `summarize_whatsapp_groups`, or manual trigger), the user receives a separate message per group showing the **configured group name** (not JID) and a **short friend-style briefing** — like someone telling you what was discussed, what happened, and how it felt, not a structured report.

## User stories

- As the owner, when a scheduled summary fires, I want the message header to show my configured group name, so I instantly know which group it is.
- As the owner, I want the summary to read like a friend briefing me — what the topic was, what people said, what was decided, and the vibe.
- As the owner, I want natural prose, not labels or bullet points.
- As the owner, I want on-demand summaries (Hugo / manual trigger) to use the same tone as scheduled ones.
- As the owner, I want push notification titles to use the group name, not a JID fragment.

## Acceptance criteria

- **Given** group `jid` with `name = "הורים כיתה ג'"` in `whatsapp_groups`, **When** summary is triggered, **Then** the delivered WhatsApp message header is `📋 סיכום קבוצה — הורים כיתה ג'` and contains no raw JID.
- **Given** buffered messages in a group, **When** Gemini summarizes, **Then** output is 2–4 sentences of natural Hebrew prose with no labels, bullets, or message quotes.
- **Given** low-signal messages (logistics, memes only), **When** summarized, **Then** the friend-style text says so plainly without inventing drama.
- **Given** bridge sends `groupName` from `GroupRule.name`, **When** `groupName` is missing, **Then** API falls back to DB lookup by `groupJid`, then to JID fragment as last resort.
- **Given** `summarize_whatsapp_groups` tool (all groups), **When** complete, **Then** each group is a separate WhatsApp message with the new format.

## Data model

No schema changes. Group name already exists in:

- `packages/database/src/schema.ts`: `whatsapp_groups.name`, `whatsapp_groups.jid`
- `packages/database/src/schema.pg.ts`: same columns
- Bridge: `GroupRule.name` in `apps/whatsapp-bridge/src/group-config.ts`

Migration: none (additive behavior only).

## tRPC API

Router: existing `packages/api/src/routers/whatsapp.ts` — no new procedures.

| Procedure | Kind | Input | Return | Auth | Change |
|---|---|---|---|---|---|
| `whatsapp.summaries.trigger` | mutation | `{ groupJid?: string }` | `{ results, okCount, failCount }` | protected | WhatsApp output uses friend-style briefing |
| `whatsapp.groupsDueForSummary` | query | `{ time: "HH:MM" }` | `{ jid, name }[]` | protected | unchanged |

## HTTP / Bridge (non-tRPC)

| Endpoint | Method | Body | Change |
|---|---|---|---|
| `/api/whatsapp/group-summary` | POST | `{ groupJid, groupName?, messages }` | Accept `groupName`; resolve name from DB if missing; call updated `summarizeGroupMessages` |
| Bridge `/groups/summarize` | POST | `{ groupJid }` | Send `groupName` from `getGroupRule(jid).name` in webhook body |

### Output format

```
📋 סיכום קבוצה — {groupName}

{2–4 sentences — friend briefing: topic, what was discussed, outcome if any, vibe}
```

Example:

```
📋 סיכום קבוצה — הורים כיתה ג׳

בעיקר דיברו על מועד הפגישה הבאה — דני שאל מתי, מיכל ענתה שזה ברביעי ב-10. שיח רגוע ופרקטי, אין משהו דחוף שלא נסגר.
```

- Language: Hebrew (unless most messages are in English).
- Total body length: up to ~400 characters.
- No labels, bullets, or headings in the body.
- Do not invent facts not present in messages.

### Gemini prompt direction

Write as a friend briefing the user over coffee. Cover topic, discussion, outcome/decision, and vibe in natural flowing prose. No structured format.

## UI surface

No UI changes. Group names are already configured in `apps/web/src/app/settings/whatsapp/page.tsx`.

Push title in `apps/web/src/app/api/whatsapp/group-summary/route.ts`: `📋 סיכום קבוצה — {groupName}`.

## Out of scope

- Changing summary schedule / cron grid (stays every 15 minutes).
- Merging multiple groups into one message.
- Changing FOMO / keyword alert algorithms.
- Buffer persistence (stays in-memory).
- Database schema changes.

## Open questions

- None (tone approved: friend-style narrative).
