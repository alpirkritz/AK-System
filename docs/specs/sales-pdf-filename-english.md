# Sales PDF filename — English document type

## Goal

Exported PDF filenames always use English document-type labels (and English "draft") so Drive/OS sorting and filenames never mix RTL Hebrew with LTR date/number segments.

## User stories

- As a business owner, I want saved invoice PDFs named in English, so that filenames stay LTR and do not reverse or break in Drive/Finder.
- As a business owner, I want the printed document body to stay Hebrew when the document language is Hebrew, so that clients still see the correct invoice language.

## Acceptance criteria

- Given any sales document (Hebrew or English language), when the print page sets `document.title` via `buildDocumentFileName`, then the type segment uses `DOCUMENT_STRINGS.en.documentTypes` (e.g. `Tax_Invoice`, not `חשבונית_מס`).
- Given an unissued draft, when building the filename, then the draft marker is `draft` (not `טיוטה`).
- Given a Hebrew document language, when viewing the on-screen/print preview body, then Hebrew labels are unchanged.
- Given existing date prefix format, when building the filename, then `YYYY_MM_DD_EnglishType_DocNumber` is preserved.

## Data model

No schema changes.

## tRPC API

No API changes.

## UI surface

- `packages/types/src/sales.ts` — `buildDocumentFileName` always uses English strings for type + draft.
- Print page continues to call the same helper; no UI copy change on the document body.
- Unit tests in `packages/api/src/lib/sales-types.test.ts` updated.

## Out of scope

- Changing visible document titles inside the printed HTML body.
- Renaming already-downloaded PDFs.
- Changing document type labels in the app UI (list/filters/forms).

## Open questions

- None — user requested English type in print/export filename only.
