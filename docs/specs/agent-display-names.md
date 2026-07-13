# Spec: Custom agent display names

> **Slug:** `agent-display-names`
> **Stack:** next-trpc-monorepo
> **Status:** Approved (user request)
> **Created:** 2026-07-13

## Problem

Agent names in the UI come from the `# Title` in `A_Agents/*.md` (e.g. "Calendar Optimizer").
The user wants to rename agents in the UI (e.g. calendar optimizer → "טמפו" / Tempo) without
editing markdown files.

## Solution

Store per-agent custom display names in `user_settings.agent_display_names` (JSON map:
`agentId → string`). When set, override the markdown title everywhere in UI, push titles, and
WhatsApp/Telegram alias resolution (lowercase custom name → agent id).

## API

- `settings.agentDisplayNames.get` → `{ names: Record<string, string>, agents: { id, name, defaultName, role }[] }`
- `settings.agentDisplayNames.set` → `{ agentId, displayName: string | null }` (null = reset)

## UI

- `/agents/manage`: display name input above the markdown editor; save via tRPC; show default name as hint.

## Non-goals

- Changing the markdown `# Title` or agent instructions.
- Auto-updating Hugo's hardcoded delegation copy ("אופטי") — custom names apply to display and aliases only.

## Acceptance

- [ ] User can set "טמפו" for `06_calendar_optimizer` and see it on `/agents` and `/agents/manage`.
- [ ] Push/cron titles use the custom name.
- [ ] Typing `/agent טמפו …` or `תריץ טמפו` resolves to the correct agent when alias matches.
- [ ] Reset (empty name) restores markdown default.
