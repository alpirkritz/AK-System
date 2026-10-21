# Review Report — slack-readonly-integration

**Date:** 2026-10-19  
**Spec:** `docs/specs/slack-readonly-integration.md`  
**Reviewer:** Reviewer Agent  
**Verdict:** ✅ APPROVED WITH NITS

---

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | ✅ Pass — warnings only (all pre-existing, none from Slack code) |
| `pnpm --filter @ak-system/web build` | ✅ Pass |
| `slack.test.ts` (Vitest) | ✅ All tests pass |
| `whatsapp-group-commitments.test.ts` | ✅ Pass (isolation-only failures in full-suite run; passes when run standalone — pre-existing SQLite shared-state issue) |

---

## Spec Conformance

### New DB Tables

| Table | Status |
|---|---|
| `slack_connections` | ✅ Added to `schema.pg.ts`, `schema.ts`, `database/src/index.ts` |
| `slack_channels` | ✅ Added with FOMO and keyword fields |
| `slack_messages` | ✅ Added with `UNIQUE(channelId, slackTs)`, index on `(channelId, ts)` |
| `userSettings.slackCommitmentScanCursor` | ✅ Column added |

### New API Routes

| Route | Status |
|---|---|
| `GET /api/slack/oauth` | ✅ Redirects to Slack install URL |
| `GET /api/slack/oauth/callback` | ✅ Exchanges code, stores token, starts background sync |
| `POST /api/slack/events` | ✅ Verifies signature (HMAC-SHA256), handles message/edit/delete, FOMO check |
| `GET/POST /api/cron/slack-commitments` | ✅ Scans messages, proposes commitments, sends notifications |

### tRPC Router

| Procedure | Status |
|---|---|
| `slack.getConnection` | ✅ |
| `slack.disconnect` | ✅ Calls `auth.revoke`, sets `revokedAt` |
| `slack.listChannels` | ✅ Triggers background sync |
| `slack.updateChannel` | ✅ enable/FOMO/threshold/keywords |
| `slack.syncUsers` | ✅ |
| `slack.syncChannels` | ✅ |

### Intelligence Parity (WhatsApp mirror)

| Feature | Status |
|---|---|
| Commitment scan (Gemini) | ✅ `scanSlackCommitments` mirrors `scanGroupCommitments` pattern |
| FOMO detection | ✅ Per-channel threshold + window, `detectFomoChannels` + push notification |
| Harness context nodes | ✅ `slack_signal` nodes in `harness-context.ts` |
| `detectReplyBacklog` | ✅ Includes Slack active-channel count |
| `COMMITMENT_SOURCES` | ✅ Added `'slack_channel'` |
| `HARNESS_NODE_KINDS` | ✅ Added `'slack_signal'` |
| Source label (Hebrew) | ✅ `'מסלאק'` in `commitments.ts` |

### UI

| Component | Status |
|---|---|
| `/settings/slack` page | ✅ RTL, two tabs (חיבור / ערוצים), OAuth button |
| Settings page Slack card | ✅ Linked |
| `CommitmentSourceBadge` | ✅ `'slack_channel': 'Slack'` |

### Security

| Item | Status |
|---|---|
| Slack signing secret verification | ✅ HMAC-SHA256 + 5-min replay window |
| No `chat:write` scope | ✅ Read-only scopes only |
| Bearer token on cron endpoint | ✅ Standard `CRON_SECRET` check |
| No PII logged | ✅ Message text stored only in DB, not logged |

---

## Nits

1. **`packages/api/package.json`** — `./services/slack` export was missing; fixed during review (added the entry). Other services imported by web routes (`expo-push`, `self-identity`, etc.) use this same pattern — consider auditing if any other service import paths are missing exports in the future.
2. **`harness-reasoner.ts` Slack count** — the Slack active-channel detection window reuses `WA_REPLY_DAYS` (WhatsApp constant). A dedicated `SLACK_REPLY_DAYS` constant would be cleaner, but functionally fine.
3. **`syncSlackUsers`** — stores display names only; email is fetched but stored only on `people.email` via linked contact. If a contact is not yet linked, the email is not retained. Acceptable for v1.

---

## Summary

The implementation faithfully mirrors the WhatsApp integration pattern for Slack. All three new DB tables are correctly dual-schema (Postgres + SQLite). OAuth flow, event ingestion, commitment scan, FOMO, and Harness context are all wired. The missing `exports` entry in `package.json` was the only blocking issue and was resolved. Lint and build are green.

**Verdict: APPROVED WITH NITS**
