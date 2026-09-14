# Code Review: Fix WhatsApp cluster summary delivery

> **Slug:** `fix-whatsapp-cluster-summary-delivery`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-09-14

## Spec Conformance

Fallback reads persisted `whatsapp_messages` for the local calendar day (`today`). A quiet day still delivers `היום לא קרה כלום.` — never a blank body.

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS (pre-existing warnings only) |
| `pnpm test` | PASS |
| Playwright `e2e/whatsapp-labels-cluster.spec.ts` | PASS |
| `pnpm --filter @ak-system/web build` | Not re-run in this pass; run as part of `pnpm deploy:ec2` before shipping |

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.btn` / `.card` utilities
- [x] Dark theme navy/green matches the Labels tab
- [x] RTL preserved (`join(' · ')` member list)
- [x] Mobile: same stacked cards, preview below the list
- [x] Loading: existing "מסכם…" on the button
- [x] Error/empty: Hebrew banner; preview still shown when text exists
- [x] No new CSS frameworks
- [x] Reuses Labels tab

### Findings
- Must-fix: none
- Nits: preview is session-only (clears on refresh); acceptable for on-demand.

## Findings

### Must-fix

None.

### Nits

- Browser Web Push still runs only on the webhook path (`group-cluster-summary`). Fallback uses in-app notification + FCM, not `sendBrowserPush`.
- When the live bridge cluster path succeeds, `text` is omitted so the settings preview stays empty; WhatsApp + webhook notifications still fire.
- Full Next production build was not re-run here; deploy script must rebuild.

## Out of Scope Creep

None. Unlabeled groups (הורים גן אלונה, מועדונית) are not auto-assigned.

## Suggested PR Description

Make clustered WhatsApp summaries survive empty bridge buffers: 24h DB fallback, show the briefing in Settings, notify on fallback, and call web from the bridge over the Docker network.
