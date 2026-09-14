# Fix WhatsApp cluster summary delivery

> **Slug:** `fix-whatsapp-cluster-summary-delivery`
> **Status:** Approved
> **Last Updated:** 2026-09-14

Detected stack: `next-trpc-monorepo`

## Goal

On-demand and scheduled label-cluster summaries must be visible to the user even when the bridge in-memory buffer is empty (container restart) or the public webhook callback fails. The settings page must show the generated text, not only a toast. Fallback reads persisted `whatsapp_messages` for the **local calendar day** (`window: 'today'`, Asia/Jerusalem midnight → now), not a rolling 24h. A quiet day still delivers a real briefing that says nothing happened — never a blank WhatsApp body.

## User stories

- As the owner, when I click **סכם עכשיו**, I want the briefing on screen and on WhatsApp / notifications, so I am not guessing whether it ran.
- As the owner, after a bridge restart, I still want an evening cluster digest from stored history, so I do not get silence.
- As the owner, I want the label card to list which groups are in the cluster, so I notice if the busy parent group is missing.

## Acceptance criteria

- Given the bridge returns any cluster error (empty buffer, 4xx, network), when `summaries.trigger({ labelId })` or the evening cron runs, then the app loads `whatsapp_messages` for those JIDs since local midnight (`today`) and generates one cluster briefing if any messages exist.
- Given none of those groups have messages since local midnight, when the cluster run finishes, then it still delivers `📋 סיכום — {label}` plus the body `היום לא קרה כלום.` (chat + WhatsApp + notification). It does not send a blank body and does not fail as “no messages”.
- Given Gemini returns an empty string, when a cluster or per-group summary is built, then the same quiet-day body is used instead of throwing or sending whitespace.
- Given a briefing is generated (including quiet-day), when delivery runs, then it is saved to `chat_messages`, sent via bridge `POST /send`, and written as an in-app notification. If WhatsApp send fails, `ok` is false and the UI still shows the text.
- Given **סכם עכשיו** succeeds, when the mutation returns, then the Labels tab renders the briefing body (not only "נשלח סיכום מאוחד").
- Given a clustered label, when the card renders, then enabled member group names are listed under the title.
- Given Docker Compose, when the bridge calls back for summaries/ingest/cluster, then it uses `http://web:3000/api/whatsapp/...` so ngrok is not required for that hop.

## Data model

No schema changes.

## tRPC API

Router: `packages/api/src/routers/whatsapp.ts`. Shared runner: `packages/api/src/services/whatsapp-cluster-run.ts` (used by the router and `apps/web/src/app/api/cron/whatsapp-group-summary/route.ts`).

`whatsapp.summaries.trigger` cluster result adds optional `text: string` (full briefing including header).

## UI surface

`apps/web/src/app/settings/whatsapp/page.tsx` Labels tab: member names on the card; preview of last trigger text.

## Out of scope

- Auto-assigning unlabeled groups (e.g. הורים גן אלונה) to a label — the owner still picks membership.
- Changing FOMO.

## Open questions

- None.
