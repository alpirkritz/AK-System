# Reviewer verdict: relationship-needs-1on1

**Verdict: APPROVED WITH NITS**

Spec: `docs/specs/relationship-needs-1on1.md`

## What changed

- `packages/api/src/services/relationship-attention.ts` (new): one status per person (`needs_1on1` / `steady` / `good`) from every channel: meetings analysed or not, WhatsApp DMs, email threads, and the manual last contact. Pure `evaluateAttention` rules, plus a bulk loader (a few queries, no per-person round trips). Suppression covers a 1:1 booked within 7 days and "ראיתי" (`people.attention_ack_at`).
- `people.attention_ack_at` was added to `schema.pg.ts`, `schema.ts` and the SQLite bootstrap.
- `insights.relationshipBoard` returns `attention` per person and includes active people with no analysed meeting. `relationshipFlags` returns `needs1on1` and keeps the `cooling`/`warming` keys for installed phone builds. There is a new `acknowledgeAttention` mutation. `personContext.lastContactAt` comes from all channels, and there is a new `lastContactChannel`.
- Meeting prep, the morning-brief flags, the person recommendation and the harness `cooling_with_open_loop` card all use the new status.
- Web: `/relationships` is grouped as צריך 1:1 / בטיפול / במצב טוב / יציבים / thin (the last three collapsed). Each card has reason chips, the last contact with its channel, the last 1:1, "קבע 1:1" (Google Calendar invite) and "ראיתי" / "החזר לרשימה". The dashboard banner reads "כדאי לקבוע 1:1". The people-list pill reads "צריך 1:1". The person card shows the channel of the last contact.
- Mobile: the same labels, and `attention-shift.ts` in lockstep with web.
- Labels live in `packages/types/src/relationship.ts`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm test` (packages/api) | 1437 / 1437 passed (9 new) |
| Web vitest | 319 / 319 passed |
| `pnpm -r run lint` | clean |
| `pnpm --filter @ak-system/web build` | passed |
| Mobile `tsc --noEmit` | clean |
| Playwright: `relationship-needs-1on1`, `meeting-people-picker`, `layout-reorder` | passed |
| Playwright: `meeting-relationships` "create a meeting type…" | **fails, pre-existing**: the "כל הסוגים" chip no longer exists on /meetings. Not touched by this change. |

## Nits / follow-ups

- Postgres: add `ALTER TABLE people ADD COLUMN attention_ack_at TEXT` by hand if prod runs on Postgres (only SQLite has a bootstrap).
- 1:1 detection uses the larger of linked contacts and calendar invitees, with rooms filtered by name. A 1:1 whose invite lists a room under an unusual name may count as a group meeting.
- Open question 1 in the spec (Dragontail / Teams as a source) still stands.
