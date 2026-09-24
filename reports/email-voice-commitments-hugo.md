# Code Review: Email Archive, Voice Capture, and Hugo Commitment Integration

> **Slug:** `email-voice-commitments-hugo`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-09-24

## What shipped

- **Email archive.**
  - `services/email-sync.ts` searches the last 30 days of every connected Google account for mail from, to or cc a confirmed person. Addresses come from `people.email` and `person_external_ids` (provider `email`). The query is Gmail metadata plus snippet only, with no bodies.
  - One `person_email_threads` row per (thread, person) holds the latest subject, from, to, date, snippet and message count. A row is updated only when the thread has newer mail.
  - Commitments are proposed from new mail in the last 7 days, using the Hebrew verb heuristic plus a few English patterns. Source `email`, linked to the Gmail thread.
  - The cron `/api/cron/email-sync` runs hourly. There is also a `email` router with `threadsForPerson` and `syncNow`.
- **Voice capture.**
  - `POST /api/voice/upload` (multipart, web session or mobile bearer) requires consent, at least 10 seconds and at most 19 MB. The file is stored in `VOICE_STORAGE_DIR`, which defaults to next to the DB (`/data/voice` on EC2).
  - Processing runs in the background: Gemini transcribes, then `analyzeTranscript` runs. The analysis always sits on a meeting: the one given, or a placeholder `source='voice'` meeting "שיחה מוקלטת · <people>". The recording's people become that meeting's attendees, so warmth and open loops include it.
  - Action items become `voice` commitments.
  - The `voice` router: `list`, `listForPerson`, `get`, `getAnalysis`, `attachCandidates`, `attachToPeople`, `retry`.
  - Attaching to a real meeting moves the analysis, the people and the commitments, and deletes the placeholder.
  - `GET /api/voice/{id}/audio` streams a recording to the signed-in owner only.
- **Web recorder `/voice`.**
  - Before recording: consent checkbox with a legal note, and a people picker (pre-filled from `?person=`).
  - While recording: timer, level bars, pause/resume, stop and send; upload shows progress.
  - After upload: the result card polls until analyzed, then shows the key insight and action items and lets you set people and pick a meeting that just ended. Failed or stuck recordings get "נסה שוב".
  - Reachable from the nav ("הקלטות") and from "הקלט שיחה" on every person card.
- **Commitments from every analysis.** Notion transcripts (the cron, `meetings.analyzeTranscript`, Notion auto-analysis) and voice now propose commitments from action items:
  - An item owned by an attendee goes to that person.
  - My items, or items with no owner, go to the only other attendee. With several attendees, owner-less items stay on the analysis.
- **Unified queue.** `/commitments` and the person card show a source badge (Notion / WhatsApp / Email / הקלטה) and a link to the source (Gmail thread, or the meeting summary for analysis and voice). Accepting an analysis or voice commitment sets `tasks.meetingId`.
- **Hugo.**
  - The morning brief adds "התחייבויות פתוחות:" (today's attendees, both directions, with source) and "זכור לטפל:" (my other open commitments), after the events.
  - Meeting prep adds "X · התחייבות פתוחה (מהאנליזה/מהוואטסאפ/מאימייל/מהקלטה): …" per attendee, for both people meetings and circles. It uses the commitment text only, never the raw snippet.
- **Person card.** New "אימיילים" section (subject, date, snippet, Gmail link) and "הקלטות קוליות" section (date, duration, topic or status, inline player, link to summary). Mobile shows both read-only on the person screen.
- **Merge.** Merging people moves email threads and recording links, dropping duplicates the kept person already has.

## Spec Conformance

Every acceptance criterion is met except native mobile recording (see Should-fix). The spec's "Implementation Decisions" section records every deviation:

| Spec | Shipped | Why |
|---|---|---|
| `gmailThreadId` unique | `accountEmail::threadId`, unique per (thread, person) | Thread ids are per account, and one thread with two known people belongs on both cards. |
| Gmail link `/mail/u/{account}/#all/{id}` | `/mail/u/?authuser={email}#all/{id}` | Opens the right account without knowing its index. |
| Reuse `searchGmailMessages` | Own metadata fetcher | That function fetches full bodies and has no To/Cc. |
| Standalone recording, no meeting | Placeholder `source='voice'` meeting | `meeting_analyses.meeting_id` is NOT NULL, and warmth and open loops read analyses through meetings. |
| Task `notes` gets the source link | `sourceUrl` on the commitment + `tasks.meetingId` | `tasks` has no notes column. |
| Mobile recorder with `expo-av` | Web recorder; mobile read-only | `expo-av` is deprecated; `expo-audio` isn't installed, and `apps/mobile/package.json` holds an unrelated in-progress Expo upgrade. Needs a go-ahead and an APK build. |
| — | `voice_recordings` also has `status`, `error`, `mime_type`, `size_bytes`, `created_meeting_id`; `person_email_threads` also has `message_count` | Needed for background processing, retry, playback and placeholder cleanup. |

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS (no findings in changed files) |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm test` | 887/887 api, 233/233 web |
| Mobile `tsc --noEmit` | PASS |
| New e2e | 4/4 (full suite: see `reports/qa-email-voice-commitments-hugo.md`) |
| Bootstrap vs drizzle | `drizzle-kit push` after bootstrap: "No changes detected" |

## Findings

### Must-fix
- None.

### Should-fix
- **No native mobile recorder yet.** The spec's mobile FAB and recorder need `expo-audio`, a change to `apps/mobile/package.json`, and a new APK. Until then, record from the phone's browser at `/voice`; MediaRecorder works in mobile Chrome and Safari.
- **Two task paths for one action item.** The meeting page can still create a task straight from an action item, and doing so doesn't close the matching proposed commitment. Dismiss it in `/commitments`, or it will be handled when the meeting page moves onto the queue.

### Nits
- **Gmail fetch is sequential.** `fetchGmailHeaders` makes one `messages.get` call per message. That's fine hourly for a personal inbox, but it could be batched if volume grows.
- **Audio responses are whole files.** `GET /api/voice/{id}/audio` sends the file without Range support, so seeking in long recordings reloads from the start in some browsers.
- **Two analyses on one meeting.** A recording attached to a meeting that already has a Notion analysis leaves two analyses on it, and the meeting page shows the first one it finds. The voice one stays reachable from `/voice`.
- **Uploads are held in memory.** Up to about 19 MB plus base64 for Gemini, one at a time, on the 1 GB box. This is acceptable for a single user.

## Security and privacy

- Consent is required on every upload and stored as `consent_confirmed_at`. It is enforced on the server, not only in the UI.
- Upload and audio routes use the same session rules as tRPC (`lib/request-session.ts`). The audio path comes from the DB only, never from the request.
- Email stores metadata and a 200-character snippet, for confirmed people only; there are no bodies. The existing `gmail.readonly` scope is reused, and an account without it is skipped and reported.
- Audio goes to Gemini only for transcription of a consented recording. Meeting prep still never carries raw text; commitment lines are the short task text.

## Production (EC2)

1. Back up `/data/ak_system.sqlite` on the `web-data` volume, then `pnpm deploy:ec2`. The new tables are created by `getDb()` on first use, and every change is additive. Recordings are written to `/data/voice` on the same volume.
2. Reinstall the EC2 crontab (`scripts/install-server-cron-remote.sh`) to add `email-sync` (hourly at :20).
3. `GEMINI_API_KEY` must be set (it already is for analyses). No new env vars are required; `VOICE_STORAGE_DIR` is optional.
4. After deploy, check that `/api/cron/email-sync` returns an empty `accountErrors`. An account listed there needs reconnecting in Settings.

## UI/UX Review

**Verdict:** APPROVED WITH NITS

- [x] Uses `.btn` / `.input` / `.card` / `.pill` / `.label`. The source badge is a shared `CommitmentSourceBadge` used on the card and the page.
- [x] Dark palette tokens only (`#5a688c`, `#97a4c2`, `#b8c4dc`, `#eef3fb`, `#e8c547`, `#223052`)
- [x] RTL: logical `ms-auto` / `text-start`; mobile uses `writingDirection: 'rtl'`
- [x] Focus-visible outlines on the icon-only Gmail and play buttons, which also have `aria-label`s naming the thread or action
- [x] `/voice` states:
  - Before recording, "התחל הקלטה" stays disabled until consent is checked, and the legal note sits under the checkbox.
  - While recording: `role="timer"` and paused/recording text.
  - During upload: `role="status"` with a progress bar.
  - After upload: `aria-live` on the result card, a waiting note ("…אפשר לעזוב את העמוד, תגיע התראה"), and "נסה שוב" on errors.
  - The recent list has an empty state.
- [x] Microcopy explains what happens next ("תגיע התראה כשזה מוכן") and why a recording was refused ("קצרה מ-10 שניות ולא נשמרה").
- **Nit:** the level bars are a simple peak meter, not a scrolling waveform; this is enough to show the mic is live.
- **Nit:** the people picker's options use `role="option"` inside a plain list without a combobox. It's fine for mouse and touch, but arrow-key navigation isn't wired.

## Suggested PR Description

Email threads with known people are archived hourly (metadata and snippet only) and shown on the person card with Gmail links. Consented voice recordings are uploaded, transcribed and analyzed like Notion transcripts, and attached to people and, optionally, a meeting that just ended. Action items from every analysis, email promises and voice recordings now land in the shared `/commitments` queue with source badges and links. Hugo's morning brief lists open commitments for today's attendees plus a "זכור לטפל" block, and meeting prep lists each attendee's commitments by source.

## Follow-up: EC2 deploy and native mobile recorder (2026-09-24)

### Deploy (done)

- Backup: `~/backups/ak_system-20260924-145313.sqlite` on the instance (online `.backup`, `integrity_check` ok), with a copy on the Mac at `~/ak-backups/`.
- Rehearsal on a copy of that backup before deploying:
  - At container start, `drizzle-kit push` sees `whatsapp_messages.pinned` / `people.capture_whatsapp` as "not-null without default". This is a drizzle-kit false alarm, since both have defaults. With no TTY it aborts with exit 0 and changes nothing.
  - `getDb()` then creates every table and column from steps 1–3.
  - Row counts are unchanged. The 32 orphaned `meeting_notes` rows were already there.
- `SKIP_CI=1 pnpm deploy:ec2`. The container matched the rehearsal. Cron was reinstalled (`email-sync`, `whatsapp-dm-summary`, `people-duplicates`).
- First `email-sync`: 65 threads for 18 people, `accountErrors: []`.
- Probe of `/api/voice/upload` on production: mobile bearer plus a 5 s file → 400 "קצרה מדי"; no auth → 401.

### Mobile recorder

- `expo-audio ~56.0.13` plus its config plugin (Hebrew mic permission, no background recording). App version 1.0.2 / versionCode 3.
- `apps/mobile/app/record.tsx` records mono AAC at 48 kbps, which keeps about 40 minutes under the 19 MB cap.
- `lib/voice.ts`:
  - Multipart upload via `XMLHttpRequest`, because React Native's fetch reports no upload progress.
  - tRPC wrappers for `voice.get` / `getAnalysis` / `attachCandidates` / `attachToPeople` / `retry`.
- `lib/voice-format.ts` holds the pure helpers, covered by `lib/voice-format.test.ts` (4 tests, `node:test`).
- Entry points: "הקלט שיחה" on the person screen (preset person) and on the meetings tab.
- API: added a test that `audio/mp4` uploads are accepted and stored as `.m4a` (13/13).
- Mobile `tsc --noEmit` is clean.

### UI/UX Review (mobile)

**Verdict:** APPROVED WITH NITS

- [x] Consent is a real checkbox (`accessibilityRole="checkbox"` + state). "התחל הקלטה" stays disabled until it is checked, and the legal note matches the web text.
- [x] Recording: large tabular timer (`accessibilityRole="timer"`), live/paused dot, metering bars hidden from screen readers, and 48 pt pause/resume and "עצור ושלח" buttons.
- [x] Upload: `progressbar` role with a value. After upload, a `polite` live result card, with retry when failed or stuck.
- [x] Attaching to a just-ended meeting uses radio rows (44 pt) with "בלי פגישה" as the default.
- [x] Guard rails:
  - Leaving mid-recording or mid-upload asks for confirmation.
  - Going to the background pauses and explains why.
  - A denied mic shows a "פתח הגדרות" link.
  - Recordings under 10 s are refused with the reason.
- [x] RTL: `row-reverse` rows, `textAlign: 'right'` / `writingDirection: 'rtl'`, theme tokens only.
- **Nit:** the person screen reloads its recordings only when reopened, not when coming back from the recorder.
- **Nit:** people can be chosen only via the person-screen preset. A recording started from the meetings tab has no people until it is attached on the web.

**Reviewer verdict for the follow-up:** APPROVED WITH NITS
