# WhatsApp daily digest of followed groups

> **Slug:** `whatsapp-daily-digest`
> **Status:** Draft
> **Last Updated:** 2026-09-22

## Goal

Marking a WhatsApp group with מעקב means “include this group in the end-of-day picture.” Today that flag stores messages and turns on FOMO, while the evening cron still sends a separate friend-style bubble per group or per opted-in label. This spec replaces that evening outcome with one Hebrew briefing of every enabled group: action items first, then one block per label, then a single quiet line. The action block is omitted entirely when there is nothing to do. The same text is stored as the in-app notification, using headings and bullets the notification screen already renders, so the phone and the web inbox are as easy to scan as the WhatsApp message.

## User Stories

- As the owner, I want one evening message that covers every group I marked מעקב, so I do not open each chat or read a separate bubble per group.
- As the owner, I want concrete action items from all of those groups at the top, so the first thing I see is what I need to do.
- As the owner, I want no action section at all when nothing needs me, so an empty “צריך אותך” does not cry wolf.
- As the owner, I want the rest of the day grouped by the label I already assigned, with a duplicate fact stated once, so related groups read as one cluster.
- As the owner, I want sections ordered so the clusters that need me come before quiet chatter, so I can read top to bottom.
- As the owner, I want a followed group that was quiet today named in one quiet line, so I can see it was included and not dropped.
- As the owner, I want the in-app notification (web and mobile) to show the same sections, headings, and bullets, so opening the alert is the readable version.
- As the owner, I want a followed group’s own summary time or «סכם כאשכול» not to send another bubble after this digest on the same local day, so the evening stays one message.

## Acceptance Criteria

- [ ] Given three groups with `whatsapp_groups.enabled = true` and one with `enabled = false`, when the digest runs, then the false group is absent from actions, sections, and the quiet line.
- [ ] Given no enabled groups, when the digest slot matches, then no WhatsApp message, push, or `chat_messages` row is written.
- [ ] Given enabled groups and zero stored messages for local `today` (`resolveWhatsappTimeWindow({ window: 'today' })`), when the digest runs, then the only body after the date header is `היום לא קרה כלום.` and the text does not contain `צריך אותך`.
- [ ] Given today’s messages contain no request, unanswered question, deadline, or thing to bring, approve, pay, or confirm, when the digest is rendered, then `צריך אותך` does not appear and the first section is a label block (or `אחר`, or the quiet line).
- [ ] Given at least one grounded action, when the digest is rendered, then the order is: date header, `צריך אותך`, action bullets, then label blocks, then `שקט היום: …` if needed. Nothing is rendered above `צריך אותך` except the date header.
- [ ] Action bullets are ordered by the source’s group priority (a label uses the max priority of its groups), then by Hebrew source name. At most 8. Each bullet is one line ending with ` — {source}`. The fact is present in that source’s messages. Extra asks stay inside the label block.
- [ ] Sections are ordered: a section that owns an action before one that does not; then higher max priority; then more messages; then Hebrew name. The heading `אחר` is last among sections that have no actions. The quiet line is always last.
- [ ] Given two enabled groups share a `labelId` and both mention the same event, when the label block is rendered, then the shared event appears once in the summary. A fact present in only one of them is a point prefixed with that group name.
- [ ] Given an enabled group has no `labelId` and has messages today, when the digest is rendered, then it appears under the heading `אחר`.
- [ ] Given an enabled group has no messages today, when the digest is rendered, then its name appears only in `שקט היום: {names}` (Hebrew-sorted) and it has no section of its own.
- [ ] Given `notification_preferences` for `whatsapp_daily_digest` is missing, when the clock in `TIMEZONE` (default `Asia/Jerusalem`) equals `20:30`, when `GET` or `POST /api/cron/whatsapp-daily-digest` runs with a valid `CRON_SECRET` (or with no secret when `CRON_SECRET` is unset), then one digest is sent and `notification_preferences.last_sent_at` is stamped. A second hit in the same `HH:MM` slot does not send again (`wasNotificationSentInSlot`).
- [ ] Given the preference row exists with `enabled = false`, when the slot matches, then nothing is sent.
- [ ] Given `schedule_times` is `["21:00"]`, when the clock is `20:30`, then nothing is sent; when the clock is `21:00`, the digest is sent.
- [ ] Given the digest was already sent on the current local calendar day, when `/api/cron/whatsapp-group-summary` matches a group or cluster slot later that day, then it sends nothing and returns `skipped: "daily-digest-sent"`. A per-group or cluster slot earlier the same day, before `last_sent_at`, still sends as it does today.
- [ ] Given the digest preference is disabled, when `/api/cron/whatsapp-group-summary` runs, then per-group and cluster behavior is unchanged.
- [ ] The in-app notification body is markdown: `#` for the date line, `##` for `צריך אותך` and each section, `-` for bullets. Web and mobile notification detail already parse that shape. The list preview strips the markers and keeps this order, so the row starts with the date and the actions. WhatsApp and the chat copy are the plain-text twin (no `#`).
- [ ] Delivery uses the channels resolved for `whatsapp_daily_digest`. WhatsApp self-chat is the plain text. Push title is `צריך אותך` when there is at least one action, otherwise `מה היה היום`. Push body is the plain text from `צריך אותך` when actions exist, otherwise from the date line, truncated to 240 characters. Full markdown is stored via `createNotification` (`url: /notifications`, `type: cron`). Plain text is appended to `chat_messages` with `source: 'whatsapp'`.
- [ ] `whatsapp.digest.run` (protected) builds and sends the same digest immediately, ignoring the clock, and returns `{ ok, text, actionCount, sectionCount, quietCount }`. It does not stamp `last_sent_at`.
- [ ] Formatter unit tests cover: actions present and ordered first; actions absent with no header; section sort; shared fact once; unlabeled under `אחר`; quiet line; all-quiet body; disabled group never passed in. No Gemini call in those tests.

## Data Model

No new tables and no new columns in `packages/database/src/schema.ts` or `packages/database/src/schema.pg.ts`.

Membership and grouping use existing columns: `whatsapp_groups.enabled`, `whatsapp_groups.label_id`, `whatsapp_groups.priority`, `whatsapp_groups.name`, `whatsapp_labels.name`, `whatsapp_messages` (`group_jid`, `text`, `sender_name`, `ts`).

Schedule, enable flag, channels, and once-per-slot dedup use the existing `notification_preferences` row keyed by `type_id = 'whatsapp_daily_digest'`. The row is created on first send by `markNotificationSent`. Default time lives in the code catalog (`defaultTime: '20:30'`).

## tRPC API

Router: `packages/api/src/routers/whatsapp.ts`. Auth: `protectedProcedure`.

| Procedure | Kind | Input | Return |
|---|---|---|---|
| `whatsapp.digest.run` | mutation | none | `{ ok: boolean, text: string, actionCount: number, sectionCount: number, quietCount: number, error?: string }` |

Shared helpers in `packages/api/src/services/whatsapp-daily-digest.ts`:

- `loadFollowedGroups(db)` — enabled groups joined to labels, messages in the local `today` window.
- `arrangeDailyDigest({ dateLabel, groups, model })` — pure. Drops actions whose source is not an enabled group name or one of their label names, and drops actions for a group with zero messages. Overwrites `quiet` from groups with zero messages. Rebuilds sections from labels. Caps: 8 actions, 4 points per section, summary 280 characters.
- `renderDailyDigestPlain` / `renderDailyDigestMarkdown` — pure. Plain text for WhatsApp is capped at 4000 characters; past that, append `ועוד {n} קבוצות בכרטיס ההתראה.` The markdown stored on the notification is the full arranged text.
- `generateDailyDigestModel` in `packages/api/src/services/whatsapp-insights.ts` — one Gemini call. JSON only: `{ actions, groups: [{ name, line, detail }], shared: [{ label, summary }] }`. Not called when every followed group is empty.
- `runFollowedDailyDigest(db)` — load, arrange, deliver.
- `shouldSkipScheduledGroupSummaries({ digestEnabled, lastSentAt, timeZone })` — true when the digest type is enabled and `last_sent_at` falls on today’s local calendar day.

HTTP:

- New `apps/web/src/app/api/cron/whatsapp-daily-digest/route.ts` — `GET` and `POST`, same `CRON_SECRET` check as `daily-meeting-summary`. Uses `getSchedulablePreference('whatsapp_daily_digest')`, slot match, `wasNotificationSentInSlot`, then `runFollowedDailyDigest`, then `markNotificationSent` on success. Also sends browser push and Telegram when those channels are on (the shared runner sends WhatsApp, mobile push, and the in-app row).
- `apps/web/src/app/api/cron/whatsapp-group-summary/route.ts` — after auth, if `shouldSkipScheduledGroupSummaries` is true, return `{ ok: true, skipped: "daily-digest-sent" }` without calling `runClusterSummary` or `summarizeGroup`.
- `deploy/crontab.example` — `*/15` curl to `/api/cron/whatsapp-daily-digest`, listed before `whatsapp-group-summary`.

Catalog entry in `NOTIFICATION_TYPES`:

- `id: 'whatsapp_daily_digest'`
- `category: 'whatsapp'`
- `label: 'סיכום קבוצות יומי'`
- `description: 'סיכום אחד של כל הקבוצות במעקב'`
- `availableChannels: ['whatsapp', 'push', 'telegram']`
- `schedulable: true`
- `defaultTime: '20:30'`
- `routable` omitted

## UI Surface

`apps/web/src/app/settings/notifications` already renders `NOTIFICATION_TYPES`, so the new row shows the time field and channel toggles. Default displayed time is 20:30.

`apps/web/src/app/settings/whatsapp/page.tsx`, Groups tab, next to the existing toolbar: button **סכם עכשיו את כל הקבוצות במעקב** (`data-testid="whatsapp-daily-digest-btn"`) calls `whatsapp.digest.run`. While pending, label is `מסכם…` and the button is disabled. On success, the existing message banner shows `נשלח סיכום יומי`. On failure, it shows the error. No new route.

Notification detail (web `apps/web/src/app/notifications/page.tsx` and mobile `apps/mobile/app/notifications.tsx`) already renders `parseNotificationBody`. No new screen. The stored markdown is what makes the opened alert show a date heading, an action heading, label headings, and bullets, in the sort order above. The list row stays two lines; `notificationPreview` flattens markers so those lines start with the date and the actions.

Mobile OS push still opens `/notifications?id=<notificationId>` via the existing `notificationId` payload. Groups-tab copy for the follow toggle stays **מעקב+FOMO**.

## Out of Scope

- Phone mute, and any change to whether the bridge ingests muted chats.
- Turning FOMO off when מעקב is on, keyword alerts, or FOMO thresholds.
- Routing this digest through Hugo or changing `whatsapp_now` / `summarize_whatsapp_groups` / `messages.forTool`.
- Deleting `summaryTimes`, the «סכם כאשכול» toggle, or **סכם עכשיו** on a single label. Those still send on clock slots that occur before the digest on that local day, and on demand.
- A second digest the same day, a morning edition, or per-group digest opt-out.
- Auto-detecting related groups. Sections follow `label_id` only.
- New tables, embeddings, or a new notification renderer.
- Changing the per-group friend-style prompt used by `summarizeGroupMessages` and `generateClusterSummary`.

## Open Questions

- None. Action items are a server-rendered section, present only when the filtered list is non-empty. The digest time defaults to 20:30 and is editable on the existing notifications screen. Followed groups are exactly `enabled = true`.
