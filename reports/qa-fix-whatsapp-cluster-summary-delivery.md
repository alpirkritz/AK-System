# QA: Fix WhatsApp cluster summary delivery

> **Slug:** `qa-fix-whatsapp-cluster-summary-delivery`
> **Date:** 2026-09-14
> **Result:** PASS

## Commands

| Check | Result |
|---|---|
| `pnpm test` | PASS (API + web Vitest) |
| Playwright `e2e/whatsapp-labels-cluster.spec.ts` | PASS (1/1) |
| Full `pnpm e2e` | Not re-run (targeted spec only) |

## Coverage added

- Empty calendar day delivers `היום לא קרה כלום.` (not an error listing group names).
- `whatsapp.summaries.trigger` on a clustered label with no stored messages returns Hebrew error including those names.

## Notes

- Empty-buffer path is covered without calling Gemini.
- Live **סכם עכשיו** with real WhatsApp traffic still needs a post-deploy click.
