# Exclude the Android APK from the service-worker precache

## Goal

Stop every web visitor from downloading the ~100 MB Android APK as part of the
service-worker install.

`@serwist/next` builds its precache manifest from `globPublicPatterns`, which
defaults to `["**/*"]` — every file under `apps/web/public`. `public/helm.apk` is
therefore a precache entry, so on first visit (and again on every APK change,
because the entry is content-hashed) the browser downloads the whole binary
before the service worker activates. Confirmed in the committed artifact:

```
{'revision':'fb5f8d1b2f7ee8808f90783b054f6b25','url':'/helm.apk'}
```

The APK is a one-off manual download from the settings page. It has no business
being available offline, and it is roughly two orders of magnitude larger than
the rest of the precache combined.

This is a pre-existing bug, not a regression. It becomes more costly as the APK
grows (85 MB → ~103 MB with the current build), which is why it is being fixed
alongside the APK refresh rather than after it.

## User stories

- As a web user, the app finishes installing its service worker without silently
  pulling a 100 MB binary I never asked for.
- As a user on metered or slow data, visiting the dashboard does not cost me the
  size of the mobile app.
- As a user who wants the APK, the download link keeps working exactly as before.

## Acceptance criteria

1. `apps/web/public/sw.js` contains no precache entry whose `url` ends in `.apk`.
2. The rest of the precache manifest is unchanged in content — same URLs, same
   revisions — apart from the removed APK entry.
3. `GET /helm.apk` still serves the file over the network with a 200.
4. The exclusion is expressed as a rule about file type, not a hardcoded
   filename, so a renamed or additional APK is also excluded.
5. `pnpm --filter @ak-system/web build` passes.

## Implementation

`apps/web/next.config.js` only: set `globPublicPatterns: ['**/!(*.apk)']` on the
`@serwist/next` options.

Two other levers were tried first and do not work, which is why the glob is the
right place:

- **`exclude`** is passed to `InjectManifest` and applies to **webpack assets**.
  `public/` files enter the manifest separately as `additionalPrecacheEntries`
  (`dist/index.js:227-242, 250-257`), so it never sees them.
- **`manifestTransforms`** also never sees them. Serwist does spread caller
  transforms ahead of its own, but workbox concatenates
  `additionalPrecacheEntries` *after* all transforms have run. Verified
  empirically: adding a transform that filters `.apk` left `/helm.apk` in the
  built `sw.js`.

`globPublicPatterns` feeds `globSync` directly. Leading-`!` negation is not
supported by glob 13 (verified: `['**/*', '!**/*.apk']` still returns the APK),
but extglob negation is — `['**/!(*.apk)']` returns 11 of the 12 files in
`public/`, dropping only the APK. This satisfies the file-type requirement
without enumerating the extensions we want to keep.

## Out of scope

- Changing how or where the APK is hosted or linked.
- Runtime caching rules in `src/sw.ts`.
- Trimming any other large asset from the precache.

## Open questions

None.
