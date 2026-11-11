# person-aliases — status

**Verdict: APPROVED WITH NITS (backend + web complete; mobile and e2e outstanding). No Reviewer-agent pass yet.**

## Done
- Tables `person_aliases` (with `origin` = channel) and `identity_queue`.
- `services/person-resolution.ts`: `resolvePerson`, `resolveOrQueue`, `addAlias`, `learnAlias`, `moveAliasesOnMerge`.
- Wired paths: meeting attendees, calendar attendees, Notion people/assignees, `people.merge`, meeting/voice/Notion-meeting commitment owners (alias-aware), WhatsApp group senders, Slack senders, email From names.
- A certain match (email, phone, WhatsApp link, Slack user id) under a new name teaches that name with its channel as `origin`.
- tRPC `people.aliases.*`, `people.identityQueue.*`; web alias chips (with channel tag), identity queue card on /people, merge button "מזג וזכור את השם".
- Fixed the date-dependent `harness-reasoner` retire-on-miss test (it ran on the real clock; the VAT filing window opens in odd months).
- `pnpm test`: api 1412/1412, web 309/309. Lint: no errors. Web build compiles.

## Deviations
- No backfill: `resolvePerson` compares live against `people.name` plus aliases.
- `identity_queue` table added.
- Postgres needs `person_aliases` and `identity_queue` applied manually.

- Mobile: alias chips on the person screen (tap to remove, channel tag), identity queue card on the people screen.

## Not done
- Queue card on the web dashboard.
- Playwright e2e; UI Designer (RTL/dark) pass; Reviewer pass.
- Voice speaker labels and email sync only learn names; neither asks via the queue.
