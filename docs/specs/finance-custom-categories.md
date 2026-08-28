# Spec: Finance custom cashflow categories

> **Slug:** `finance-custom-categories`
> **Status:** Draft
> **Last Updated:** 2026-08-28

## Goal

Let Alpir define new expense/income category labels in the Finance UI (beyond the built-in list in `CASHFLOW_CATEGORIES`), use them when categorizing transactions, and see them in breakdown charts with a chosen color.

## User stories

- As Alpir, I want to add a category like "חיות מחמד" in Finance → סיווג תנועות, so I can tag transactions without editing code.
- As Alpir, I want custom categories to appear in all category dropdowns (categorize drawer, cashflow table, month composition).
- As Alpir, I want to delete a custom category I no longer need (existing transactions keep the label).

## Acceptance criteria

- [ ] `finance.listCategories` returns built-in + user custom categories with `{ label, color, kind, builtin, id? }`.
- [ ] `finance.createCustomCategory` accepts `{ label, color?, kind? }`, rejects duplicates of built-in or existing custom labels.
- [ ] `finance.deleteCustomCategory` removes a custom row by id; built-ins cannot be deleted.
- [ ] Categorize drawer shows "קטגוריות מותאמות" form (name, kind, color) + list with delete.
- [ ] All finance category `<select>` elements use `listCategories` instead of hardcoded `CASHFLOW_CATEGORY_LABELS`.
- [ ] Donut/breakdown uses custom colors via merged color map.
- [ ] Vitest covers merge/validation and create/delete API.

## Data model

### New table `finance_custom_categories` (both `schema.ts` + `schema.pg.ts`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `fcc` + timestamp |
| `label` | text NOT NULL | display + stored transaction value |
| `color` | text NOT NULL | hex, default `#647399` |
| `kind` | text NOT NULL | `'expense'` \| `'income'` |
| `created_at` | text NOT NULL | ISO |

SQLite bootstrap block in `packages/database/src/index.ts`.

## tRPC API

| Procedure | Kind | Input | Return |
|-----------|------|-------|--------|
| `finance.listCategories` | query | — | `{ categories: FinanceCategoryOption[] }` |
| `finance.createCustomCategory` | mutation | `{ label: string.min(1).max(40), color?: string, kind?: 'expense'\|'income' }` | `{ category: FinanceCategoryOption }` |
| `finance.deleteCustomCategory` | mutation | `{ id: string }` | `{ ok: true }` |

Auth: `protectedProcedure`.

## UI surface

- `apps/web/src/app/finance/components/CategorizeDrawer.tsx` — manage custom categories section.
- `apps/web/src/app/finance/components/CategorySelect.tsx` — shared dropdown from `listCategories`.
- Replace hardcoded labels in `CategorizeDrawer`, `MonthCompositionPanel`, `finance/page.tsx`.

## Out of scope

- Custom `internal` categories (credit-card style exclusions).
- Mobile app category management UI (web only).
- Editing built-in category names/colors.

## Open questions

None.
