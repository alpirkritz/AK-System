# Calendar Optimizer — secretary brief (all channels)

> **Slug:** `calendar-optimizer-whatsapp-brief`
> **Status:** Superseded for structure by `docs/specs/calendar-brief-notion-parity.md` (2026-07-22). No-tables + no-meta rules still in force there.
> **Last Updated:** 2026-07-19
> **Stack:** `next-trpc-monorepo`

## Goal

Replies from `06_calendar_optimizer` (יועץ יומן / אופטי) are long, self-referential, and include Markdown tables that break on WhatsApp and feel cluttered in ARO chat. Change presentation on **every delivery channel** (WhatsApp, Telegram, ARO web, ARO mobile) to a short secretary briefing: **bottom line first, then today's meetings as bullets**.

## User Stories

- As the owner, I want a short load summary so I know how heavy the day is in one glance.
- As the owner, I want today's meetings as plain bullets (time + title + one short note) so I can scan them on phone or in ARO.
- As the owner, I do not want the agent narrating its own instructions, memory updates, or thinking-out-loud.

## Acceptance Criteria

- [ ] On **all** channels (`whatsapp`, `telegram`, `web`, mobile/ARO chat), `06_calendar_optimizer` replies **never** include Markdown tables (`| ... |`).
- [ ] Reply structure is fixed everywhere:
  1. Optional one-line date header (≤1 line)
  2. **שורה תחתונה** — load (hours + light/manageable/heavy) + conflicts/flags (≤4 bullets)
  3. **הפגישות להיום** — one bullet per event: `HH:MM–HH:MM — Title` (+ optional note ≤12 words)
  4. Optional **המלצות** only for real conflict/overload — ≤3 bullets
- [ ] Meeting notes stay short: no dumping full task descriptions or long mandate text into schedule bullets.
- [ ] Agent does **not** acknowledge standing instructions in the reply (no "מעתה אתעלם…", no "הוראה זו נוספה", no "אני מבין/ה שביקשת…").
- [ ] Agent does **not** repeat the same analysis twice in one reply.
- [ ] When Hugo synthesizes `run_abc_agent` calendar output, it passes the brief through without a second long preamble or re-analysis.
- [ ] Analysis rules unchanged: exclude all-day / ≥8h; flag conflicts/overlaps/load >4h; recommendations-only.
- [ ] Prompt-contract test asserts the secretary-brief override is present for `06_calendar_optimizer`.

## Data Model

No schema changes.

## tRPC API

No procedure changes.

## UI Surface

No new routes or components. Chat message **content** from the calendar agent changes on ARO web/mobile chat, WhatsApp, and Telegram. Existing chat UI renders the bullets as plain text/markdown lists (no table markup).

## Implementation Plan

### 1. `A_Agents/06_calendar_optimizer.md`

Replace table-first presentation with the secretary brief for all chat/archive surfaces that the agent writes for the user.

### 2. `S_Skills/wf_calendar_optimizer.md`

Update Stage 4.1 to the same brief structure.

### 3. `apps/web/src/lib/gemini-agent-engine.ts`

- Inject a hard **Calendar Optimizer — secretary brief** override for `06_calendar_optimizer` on every channel.
- Export a small helper (or `buildSystemInstruction`) so tests can assert the override strings.
- For Hugo: when folding calendar specialist output, pass through without re-wrapping.

### 4. Tests

Prompt-contract test: system instruction for `06_calendar_optimizer` contains no-table + section headings requirements.

## Out of Scope

- Calendar data fetching / ≥8h exclusion logic.
- Redesigning Notion Inbox UI chrome (page body may use the same bullet brief).
- Unrelated WhatsApp group-summary flows.
- Agent display name / aliases.

## Open Questions

Resolved: same format on WhatsApp, Telegram, and ARO app — approved 2026-07-19.
