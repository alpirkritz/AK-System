# Spec — UI Refresh: Deep Navy + Assistant/Nav Consolidation

Detected stack: next-trpc-monorepo (+ apps/mobile Expo/React Native)

## Goal

Replace the near-black theme with a warmer "deep navy + turquoise/coral" palette across web and mobile, remove user-flow duplication (two chats, split agents, buried settings, redundant nav), and expand the Helm native app from chat-only to a full bottom-tab app.

## User stories

- As the owner, I want a pleasant, non-black color scheme so the app feels calm and modern.
- As a user, I want one clear place to talk to the assistant instead of two overlapping chats.
- As a user, I want the navigation grouped into meaningful sections so I can find things fast.
- As a user, I want consistent settings (notifications not buried, WhatsApp/memory not over-promoted).
- As a phone user of Helm, I want to reach dashboard, people, tasks and meetings — not only chat.
- As a user, I want empty/loading/error states that tell me what to do next, in clear Hebrew.

## Acceptance criteria

- Given any web page, When it renders, Then the background is deep navy (`#0e1626`), primary accent is turquoise (`#2dd4bf`), and no near-black `#0f0f0f`/gold `#e8c547` remains in shipped UI (except intentional brand colors like WhatsApp `#25D366`).
- Given the sidebar, When I view it, Then items are grouped as היום / עבודה / יומן / עוזר חכם / מידע / מערכת, and `/agents`, `/agents/manage`, `/recurring`, `/settings/whatsapp`, `/memory` are not top-level items.
- Given `/agents` or `/chat`, When I open it, Then I land on one unified "עוזר" surface with a general assistant by default and a picker to switch to a specialist agent.
- Given `/login`, When it renders, Then no sidebar/bottom-nav chrome is shown.
- Given `/settings`, When I open it, Then notification/channel config, WhatsApp, memory/agent instructions, accounts, calendars and sync are reachable as consistent sections.
- Given `/tasks`, When I open it, Then completed tasks are hidden by default and I can filter by status/project/meeting.
- Given the Helm app after login, When it loads, Then a bottom tab bar shows דשבורד / אנשים / משימות / פגישות / עוזר, each backed by live tRPC data.

## Data model

No schema changes. Additive UI/nav/data-wiring only.

## tRPC API

No new procedures required for web. Mobile consumes existing procedures via a new Bearer-authed tRPC client:
`people.list`, `tasks.list`, `tasks.toggleDone`, `meetings.list`, `calendar.events`, `feed.getLatest`, `notifications.list/markRead`. The tRPC route handler (`apps/web/src/app/api/trpc/[trpc]/route.ts`) already accepts `Authorization: Bearer`.

## Color mapping (old -> new)

- Surfaces: `#0f0f0f`→`#0e1626`, `#161616`→`#16233b`, `#181818`→`#1a2740`, `#1a1a1a`→`#1d2b46`, `#1f1f1f`→`#223052`, `#111`→`#111b30`, `#222`→`#29395d`, `#282828`→`#31456f`.
- Borders: `#2a2a2a`→`#2f4368`, `#333`→`#3a507d`, `#3a3a3a`→`#435a8c`, `#444`→`#4d659c`.
- Text: `#f0ede6`→`#eef3fb`, `#ccc`→`#b8c4dc`, `#aaa`→`#97a4c2`, `#999`→`#8593b3`, `#888`→`#7a89ab`, `#666`→`#647399`, `#555`→`#5a688c`.
- Accent: gold `#e8c547`→turquoise `#2dd4bf` (hover `#5eead4`, active `#14b8a6`); rgba `232, 197, 71`→`45, 212, 191`.
- Semantic: success `#47b86e`→`#34d399`, info `#47b8e8`→`#38bdf8`, error `#e8477a`→coral `#fb7185` (rgba `232, 71, 122`→`251, 113, 133`).
- Keep: WhatsApp `#25D366`, calendar RSVP/event brights, tag/goal decorative colors.

## UI surface

- `apps/web/src/app/globals.css` — introduce `:root` color variables; migrate utility classes.
- `apps/web/tailwind.config.js`, `apps/web/src/app/layout.tsx`, `apps/web/public/manifest.json` — palette + theme color.
- `apps/web/src/components/DashboardLayout.tsx` — regroup nav, lucide icons, hide chrome on `/login`.
- `apps/web/src/app/chat/` + `apps/web/src/components/ChatPanel.tsx`/`AgentChatPanel.tsx` — unified assistant with agent picker.
- `apps/web/src/app/agents/page.tsx` — redirect to `/chat`.
- `apps/web/src/app/settings/page.tsx` — consolidated sections.
- `apps/web/src/app/meetings/page.tsx` — recurring filter; `apps/web/src/app/recurring/page.tsx` redirect.
- `apps/web/src/app/tasks/page.tsx` — filters + hide done by default.
- `apps/web/src/app/page.tsx` — single meetings metric, warmer greeting.
- `apps/mobile/` — `app/(tabs)/_layout.tsx`, new screens, `lib/trpc.ts`, `lib/theme.ts`, `app.config.ts`.

## Out of scope

- Backend engine changes (conversation-engine vs agent-engine stay separate; UI unifies them).
- Schema/migrations, iOS build, Play Store submission.
- Rewriting calendar internals beyond color + a CRM cross-link.

## Open questions

- None (color direction = deep navy; app = Helm; assistant = merge; all flow fixes approved).
