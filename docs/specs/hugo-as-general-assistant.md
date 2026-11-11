# Hugo as the general assistant

## Goal

Make Hugo the single assistant the user talks to, everywhere. Today there are two unrelated
brains and the user does not know what the second one is:

| Surface | Who answers | Defined by |
|---|---|---|
| WhatsApp ("Message Yourself") | Hugo | `A_Agents/01_Hugo_orchestrator.md` |
| Web `/chat` | a nameless "personal assistant" | an inline prompt in `resolveIntent` |
| Telegram | the same nameless assistant | the same inline prompt |

The nameless assistant has no agent card, no Chief-of-Staff framing, and keeps Hugo at arm's
length as one more specialist to delegate to via `run_abc_agent`. User's words:
"אני לא יודע מה זה ״עוזר כללי״, אני רוצה שהעוזר הכללי שלי יהיה הוגו לא סתם עוזר כללי".

## Root cause

`resolveIntent` (`apps/web/src/lib/conversation-engine.ts:1445`) builds its own
`systemInstruction` and is the entry point for `/api/chat/route.ts` and `telegram-bot.ts`.
`whatsapp-bot.ts:166` already calls `runAgentForUser({ agentId: HUGO_AGENT_ID })`. The two
paths grew separately, so every behaviour rule had to be written twice — the time/bucket rules
added in `agent-schedule-time-awareness` had to be duplicated into both prompts, which is
exactly the kind of drift that produces inconsistent answers.

History is split too: the chat path writes `chatMessages`, the Hugo path writes
`agentMessages`. The same question asked on WhatsApp and in the app has no shared memory.

## User stories

- As the user, when I open the chat in the app I want to be talking to Hugo, by name, with the
  same persona and judgment he has on WhatsApp.
- As the user, I want one conversation thread: what I told Hugo on WhatsApp this morning should
  be context for what I ask him in the app this afternoon.
- As the user, when I type in the app's chat I do not want a push notification echoing the
  reply I am already looking at.
- As the user, I want no behaviour regression: the chat already answers calendar, task, Notion,
  WhatsApp, finance and harness questions well, and it must keep doing so.

## Acceptance criteria

- [ ] `/api/chat` and `telegram-bot.ts` route to Hugo through the agent engine instead of
      `resolveIntent`'s inline prompt. `resolveIntent`'s bespoke system instruction is deleted,
      not left behind as dead code.
- [ ] Every behaviour rule currently unique to the inline prompt is preserved — moved into the
      shared agent instruction in `gemini-agent-engine.ts` or into Hugo's card, whichever the
      rule belongs to. Specifically the Notion guidance, the WhatsApp time-window arguments,
      the harness `basedOn` citation rule, the `log_agent_feedback` wording, the
      "never redirect the user to Notion" rule, and the schedule bucket rules.
- [ ] Hugo keeps the full toolset the general assistant had. `getToolDeclarations('01_Hugo_orchestrator')`
      must be a superset of `getToolDeclarations()` — verified by a test, since the current
      gating filters `get_harness_insights` by agent id and could silently narrow Hugo.
- [ ] One conversation thread: the web chat and WhatsApp read and write the same Hugo history
      (`agentMessages` under `01_Hugo_orchestrator`), so context carries across channels.
- [ ] Interactive channels do not push. `runAgentForUser` is called with
      `notifyOnComplete: false` from `/api/chat`, from Telegram, and from `/api/agents/chat`
      — the user is looking at the reply, and an operational verification call must not
      notify at all. WhatsApp and cron keep their existing push behaviour.
- [ ] The chat UI names him: the assistant is labelled "Hugo" rather than a generic assistant.
- [ ] `channel` stays accurate (`web` / `telegram` / `whatsapp`), because the agent instruction
      branches on it for outbound formatting.
- [ ] Vitest: chat route delegates to Hugo with the right channel and with push suppressed;
      tool parity between Hugo and the former general set; history is shared across channels.
- [ ] Playwright: sending a message in `/chat` still returns an answer and renders it.

## Data model changes

None. `agentMessages` and `chatMessages` both already exist. No schema or migration.

Open decision recorded below: whether to backfill existing `chatMessages` into Hugo's thread
or leave the old web history in place and start the shared thread from the cutover.

## tRPC API shape

Unchanged. `/api/chat` keeps its request and response shape (`{ message }` →
`{ userMessage, assistantMessage }`) so the web client needs no change beyond labelling.

## UI surface

`apps/web/src/app/chat/page.tsx` — assistant messages attributed to Hugo (name and, if the
other agent surfaces have one, the same avatar/badge treatment). No layout change, no new
screen. RTL and dark theme unaffected.

## Out of scope

- Changing Hugo's card content or his delegation judgment.
- The `/agents` screen, which stays the place to run a specific specialist directly.
- Merging the specialist agents into Hugo.
- Streaming responses in the web chat.

## Open questions

1. **Backfill or cutover?** Existing `/chat` history lives in `chatMessages`. Importing it into
   Hugo's thread gives true continuity; leaving it means the old web conversation stays
   readable but Hugo starts fresh. Cutover is simpler and reversible — recommended unless the
   user wants the old thread carried over.
2. **Cost.** Hugo's prompt is heavier than the generic one (agent card + workflow + prefetched
   calendar/Notion context). Measured today: a Hugo run is 1 Gemini call on `flash-thinking`,
   roughly 15–20s. Every web chat message becomes that instead of the lighter generic prompt.
   Worth confirming the user accepts the trade for consistency.
