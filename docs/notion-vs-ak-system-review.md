# Strategic Review: Notion vs. AK System

Date: 2026-07-16
Author: Hugo orchestrator (assisted)
Status: Decision review — recommendation inside

## Bottom line

You are not really choosing between two systems — you are already running a hybrid.
The AK System codebase already treats Notion as a system of record (SoR) for meetings,
people, projects, companies, tasks, and meeting notes (`meeting_notes`), and the agents
pull live Notion context at runtime. So the real question is not *"Notion or AK"* but
*"who owns what, and what is worth pulling in."*

Recommendation: keep Notion as the capture layer and the store for rich content
(especially recordings and AI meeting summaries), and position AK System as the
automation, integration, and structured/operational-data layer. Do not migrate
everything into AK System, and specifically do not rebuild transcription/recordings now.

## 1. The dual-system reality today

- Notion = fast capture, rich editing, relations, and — critically — built-in
  recordings + transcription + AI meeting summaries.
- AK System = everything Notion cannot do for you: calendar sync (Google/Apple/Outlook),
  cron automations, morning briefings, WhatsApp/Telegram, VAT, trading journal, and
  custom agents.

Notion databases already wired into the code: `tasks`, `meetings`, `people`, `projects`,
`companies`, `ibkr_transactions`, and `meeting_notes`. Write-back is limited to an
"Assistant Inbox" for agent-run archives.

## 2. Notion review — strengths and limits

Strengths that are hard/expensive to replicate:

- Built-in meeting recordings + transcription + summaries (Notion AI). You get transcription
  effectively "for free" without maintaining a pipeline. This is the single most important
  factor in this decision.
- Excellent capture and editing (mobile/web/offline), cross-page linking, sharing with others.
- Zero maintenance, managed security, managed backups.

Limits that push you toward AK System:

- Not programmable the way you need: no custom agents/function-calling, no cron, no routing
  to WhatsApp/Telegram, no two-way calendar sync.
- API rate limits; poor fit for analytical queries (trading PnL, VAT summaries).
- Search is keyword-oriented; no semantic RAG over your data with your agents.
- Cost scales per seat plus AI add-ons; vendor lock-in (export is Markdown/CSV).

## 3. AK System capabilities — and the gaps that matter here

Strong:

- Full control: Hugo + ABC agents, function-calling, cron automations, and integrations with
  WhatsApp/Telegram/Google/Apple/Outlook/IBKR/Gmail.
- Data model tailored to you: Israeli bimonthly VAT, trading journal, health metrics,
  notification routing.
- Near-zero fixed cloud cost.

Critical gaps for this decision:

- No audio capture and no transcription anywhere in the codebase. Replicating Notion's
  recordings would be a greenfield project: audio capture -> file storage (S3, cost) ->
  transcription (Whisper/Gemini audio) -> summarization.
- No embeddings / RAG / semantic search. Memory is table-based + prompt injection (keyword),
  not semantic retrieval. Even if you pull all meeting summaries in, the agents will not
  "search" them intelligently without adding a RAG layer.

## 4. Cost, database, and EC2 implications

Current posture is intentionally cheap:

- EC2 `t3.micro` (Free Tier, us-east-1) + SQLite as a single file on a 30 GB gp3 volume +
  Cloudflare Tunnel (free). After the 12-month Free Tier: roughly USD 8-12/month
  (instance + EBS + Elastic IP if idle). No RDS, no S3.
- Main variable cost today is Gemini API tokens.
- 1 GB RAM: runs web + optional WhatsApp bridge tightly; the Next.js build runs on your Mac
  because the instance is too small.

What happens if you try to pull recordings + smart search in-house:

- Audio storage needs S3 (or a bigger disk) — added cost and management.
- Semantic search needs embeddings + a vector store. SQLite on 1 GB RAM is not enough; this
  pushes you to Postgres + pgvector (the code already has an unused Postgres path) and a
  larger instance (`t3.small`/`medium`, roughly USD 15-30+/month), plus embeddings cost.
- Net: "just pull everything into AK" turns a two-day task into a multi-week infrastructure
  project with a cost and risk jump.

## 5. Data security

- Notion: managed security, backups, and encryption at the vendor — but the data lives with
  a third party.
- AK System: data on your own EC2 volume (control advantage), but: email-allowlist auth,
  secrets in env files only (no Secrets Manager/Vault), Google tokens stored in plaintext
  columns, no at-rest encryption for SQLite, and you own backup/restore (DR) yourself.
  The more sensitive PII you pull in (meeting transcripts!), the more risk and responsibility
  shifts onto you.

Security conclusion: sensitive meeting transcripts are arguably safer left where security is
managed (Notion), rather than concentrated in an unencrypted SQLite file on a micro instance.

## 6. Recommendation — a deliberate hybrid (clear ownership)

| Area | Recommended owner | Why |
|---|---|---|
| Recordings, transcripts, meeting summaries, rich knowledge capture | Notion | Free managed transcription; managed security; rebuilding in AK is costly/risky |
| Knowledge on people/companies/projects | Notion (SoR), AK reads | Already works this way; Notion is better at editing/linking |
| Calendars, operational tasks, briefings, cron | AK System | Notion cannot do this automation |
| VAT, trading journal, health metrics, analytics | AK System | Requires structured data and queries |
| WhatsApp / Telegram / agents | AK System | Your unique IP |

Worth building now (cheap and safe): a light pull of the `meeting_notes` text from Notion
into AK as cache/context for the agents (text only, no audio, no RAG). This bridges the
"lots of information and connections" need without exploding cost or risk.

Do not build now: your own audio capture/transcription, and embeddings/RAG. That is the
trigger for a big decision (Postgres + a larger instance + cost) — not before there is real
search pain.

## 7. When to reconsider (triggers)

- If search across "all that information" becomes a bottleneck -> then, and only then,
  consider RAG (Postgres + pgvector, `t3.small`).
- If you start sharing/collaborating with other people on the same content -> Notion wins
  (sharing).
- If Notion AI / seat costs jump significantly -> evaluate moving part of transcription to
  your own pipeline.
