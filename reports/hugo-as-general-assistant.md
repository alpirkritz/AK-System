# Review — hugo-as-general-assistant

**Verdict: APPROVED WITH NITS**

Spec: `docs/specs/hugo-as-general-assistant.md`
Decisions taken by the user: history **cutover** (not backfilled), scope **web chat + Telegram**.

## Scope reviewed

| File | Change |
|---|---|
| `apps/web/src/lib/agent-runner.ts` | New `runHugoConversation` — one entry point for every conversational surface, owning history read/write |
| `apps/web/src/app/api/chat/route.ts` | Routes to Hugo; `notifyOnComplete: false` |
| `apps/web/src/lib/telegram-bot.ts` | Fallback path routes to Hugo; `notifyOnComplete: false` |
| `apps/web/src/app/api/agents/chat/route.ts` | `notifyOnComplete: false` |
| `apps/web/src/lib/conversation-engine.ts` | `resolveIntent` and its 89-line inline prompt deleted; unused imports removed; stale gating comment corrected |
| `apps/web/src/lib/gemini-agent-engine.ts` | Output-formatting, WhatsApp-argument and agent-feedback rules migrated from the deleted prompt |
| `apps/web/src/components/AssistantWorkspace.tsx` | Default mode named after Hugo; Hugo removed from the specialist list; "מדבר עם" attribution added |
| `apps/web/src/lib/hugo-general-assistant.test.ts` | +7 cases |
| `apps/web/src/lib/conversation-engine.harness-tool.test.ts` | +2 parity cases |

## Acceptance criteria

All met. The three that carried real risk:

**No rule was lost in the migration.** I diffed the deleted prompt against the agent
instruction rather than assuming. Hugo's card already covered the harness `basedOn` citation,
the Notion access rules, the synchronous-delivery rule and "never redirect to Notion". Three
groups were genuinely missing and were moved into the shared instruction: output formatting
(priority labels, HH:MM, unlinked calendar events, conflict phrasing), the WhatsApp
time-window arguments (`window`, `sinceHour`, `untilHour`), and the `log_agent_feedback`
confirmation wording. They went into the shared block, not Hugo's card, because they are
channel- and agent-agnostic.

**Tool parity is now enforced, not assumed.** `getToolDeclarations` filters by agent id, so
moving the chat onto an id could have silently narrowed it. A test asserts Hugo's set is a
superset of the ungated set; it passes because Hugo is in `HARNESS_TOOL_AGENT_IDS`.

**The push suppression is the fix for a problem I caused.** Each of my verification calls
during the previous task ran Hugo through `/api/agents/chat`, which pushed the full reply to
the user's phone — eight times in 75 minutes. Interactive surfaces now pass
`notifyOnComplete: false`; WhatsApp and cron keep pushing, since there the push *is* the
delivery.

## Nit

`/api/chat` now writes each turn twice: to `chatMessages` (what the chat UI renders, and where
the pre-cutover history lives) and to `agentMessages` (Hugo's memory). This is a direct
consequence of the cutover choice — switching the UI to read Hugo's thread would have hidden
the old conversation. Worth collapsing later by pointing `ChatPanel` at Hugo's thread once the
old history stops mattering.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/web exec vitest run` | 283 passed (37 files) |
| `pnpm --filter @ak-system/web run lint` | pass (pre-existing warnings only) |
| `pnpm --filter @ak-system/web build` | pass |

Playwright was not run in this pass; the chat e2e flow should be exercised before the next
release.

## Production verification (EC2)

```
POST /api/chat  "מי אתה? ענה בשורה אחת"
→ "אני הוגו, ראש המטה שלך ומארגן המשימות הראשי במערכת ABC."

POST /api/chat  "מה השאלה הקודמת ששאלתי אותך?"
→ "שאלת \"מי אתה?\"."
```

Both turns of both exchanges landed in the single `agent_messages` thread under
`01_Hugo_orchestrator`, which is what makes context carry between the app and WhatsApp. And
the check that matters most after the previous incident:

```
notifications since 16:30Z: []
```

Four Hugo runs from the web chat produced zero pushes.
