# Code Review: Custom WhatsApp digest prompt owns the output

> **Slug:** `whatsapp-digest-custom-prompt-format`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-10-04

## Spec Conformance

Saved prompt no longer gets `DIGEST_JSON_CONTRACT` or the `📌 לטפל` / 900-char story renderer. Default prompt path unchanged. Quiet day unchanged.

## UI Review

**Verdict:** APPROVED

Hint under the textarea now says the saved text sets message structure (headings and bullets). Same `.label` / muted hint; RTL unchanged.

## Static Checks

| Check | Result |
|---|---|
| Targeted Vitest | PASS 12/12 |
| Full lint / web build | SKIPPED |

## Findings

### Must-fix

None.

### Nits

- Change is server-side; production will keep flattening custom prompts until deploy.
- Per-group `📋 סיכום קבוצה` still ignores this editor (spec out of scope).

## Suggested PR Description

Honor a saved WhatsApp daily-digest prompt as the real output format instead of forcing JSON and a spoken-story template.
