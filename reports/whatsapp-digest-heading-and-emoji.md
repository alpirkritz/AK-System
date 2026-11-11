# Code Review: WhatsApp daily digest heading and emoji

> **Slug:** `whatsapp-digest-heading-and-emoji`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-10-04

## Spec Conformance

Matches `docs/specs/whatsapp-digest-heading-and-emoji.md`. Date header and push title are `💬 סיכום וואטסאפ יומי`. Action block is `📌 לטפל`. Default prompt asks for one emoji per group/event beat. JSON contract still forbids bullets. No schema or tRPC changes.

## UI Review

**Verdict:** APPROVED

No new controls. `/settings/whatsapp` already exposes the default prompt in **ניסוח הסיכום היומי**; the textarea picks up the new default when `whatsapp_daily_digest_prompt` is null.

### Checklist

- RTL: existing textarea `dir="rtl"`
- Design system: unchanged `.card` / `.btn` / `.input`
- Loading/error: unchanged

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | SKIPPED (copy-only) |
| `pnpm --filter @ak-system/web build` | SKIPPED (copy-only) |
| Targeted Vitest | PASS 25/25 |

## Findings

### Must-fix

None.

### Should-fix

None.

### Nits

- `digestTitle` keeps an unused `_digest` argument so callers do not change. Harmless.
- A saved custom prompt in `user_settings` will not gain the emoji sentence until the owner hits **אפס לברירת מחדל** or edits it.

## Out of Scope Creep

None. Per-group summaries and insights digest were left alone.

## Suggested PR Description

Rename the WhatsApp daily digest from `צריך אותך` to `💬 סיכום וואטסאפ יומי`, label remaining to-dos `📌 לטפל`, and ask the model for one emoji per story beat.
