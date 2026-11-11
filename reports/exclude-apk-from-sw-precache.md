# Review — exclude-apk-from-sw-precache

**Verdict: APPROVED**

Spec: `docs/specs/exclude-apk-from-sw-precache.md`
Diff: `apps/web/next.config.js` (one option added), `apps/web/public/helm.apk`
(rebuilt artifact), `apps/web/public/sw.js` (regenerated).

## Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | No `.apk` precache entry in `sw.js` | PASS — 0 entries locally and in the live `sw.js` fetched over HTTPS |
| 2 | Rest of the manifest unchanged | PASS — 19 → 18 entries; the only removal is `/helm.apk` |
| 3 | `/helm.apk` still served | PASS — byte-identical on the server (see below) |
| 4 | Rule is by file type, not filename | PASS — `['**/!(*.apk)']` |
| 5 | Web build passes | PASS |

On criterion 2, the manifest diff also shows `_buildManifest.js` and
`_ssgManifest.js` moving from build ID `bHoI6lA4EpucQtkxVb6VD` to
`a8QTthIzM7iXJs_eehSXQ`. Their revision hashes are unchanged (`c630fa55…`,
`b6652df9…`), so this is the build-ID path rotating, not a content change.

On criterion 3: `GET /helm.apk` returns 307 to `/login`. That is the pre-existing
auth gate — `src/middleware.ts:72-75` excludes `sw.js`, `manifest.json` and
`icons` from the matcher but not `.apk`, so the APK has always required a
session. It is downloaded from the settings page by a logged-in user, so this is
working as designed and is untouched by this change. Verified the artifact
directly instead:

```
local  6a92167d6e4c23f19aeb99fda67783ea7c96939bf1c36e20489d9f9b6f220f8f
EC2    6a92167d6e4c23f19aeb99fda67783ea7c96939bf1c36e20489d9f9b6f220f8f  (103500263 bytes)
```

## Static checks

| Command | Result |
|---|---|
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm --filter @ak-system/web lint` | PASS — two pre-existing a11y warnings in `CreatableSelect.tsx` / `SearchableAddSelect.tsx`, untouched here |

## Notes on the implementation choice

Two more obvious levers were tried and rejected on evidence, which is worth
recording so nobody re-litigates it:

- `exclude` applies to webpack assets only. `public/` files arrive as
  `additionalPrecacheEntries` (`@serwist/next@9.5.6` `dist/index.js:227-242`).
- `manifestTransforms` also never sees them — workbox concatenates
  `additionalPrecacheEntries` after transforms run. This was not reasoned about
  in the abstract: a filtering transform was implemented, built, and `/helm.apk`
  was still in the output.
- Leading-`!` glob negation is a no-op in glob 13 (`['**/*', '!**/*.apk']` still
  returned the APK). Extglob negation works.

## Findings

No blocking findings. One observation for the backlog, outside this spec's scope:
the APK is tracked in git at ~100 MB and re-committed on every mobile build,
which bloats the repo permanently. Serving it from object storage, or from a
location outside `public/` via a route handler, would fix both that and the auth
awkwardness noted above.

## Risk

Low. One config option narrowing a glob; the failure mode if the pattern were
wrong would be a missing precache entry, and the before/after manifest comparison
shows exactly one entry removed.
