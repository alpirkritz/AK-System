# Transcribing Recordings Over the Gemini Inline Limit (~19MB / ~40min)

**Stack:** `next-trpc-monorepo` (backend)
**Slug:** `voice-large-recording-transcription`
**Status:** Draft
**Created:** 2026-09-30
**Completes:** `voice-capture-deep-analysis.md`, section "Transcription" — that spec already called for a Gemini Files API path above ~20MB; only the inline-data path was ever actually built. This spec closes that gap.

---

## Why this is happening

`packages/api/src/services/voice.ts`:

```ts
export const VOICE_MAX_BYTES = 19 * 1024 * 1024
```

is currently a **hard reject** — both `apps/web/src/app/api/voice/upload/route.ts` (413 response) and `saveVoiceUpload` itself refuse any file over 19MB with "ההקלטה גדולה מדי (עד 19MB, כ-40 דקות)". `transcribeWithGemini` only ever sends audio as `inlineData` (base64 in the request body) — there is no `GoogleAIFileManager`/Files-API branch anywhere in the codebase (confirmed by search). 19MB is actually Gemini's own inline-request limit, not an arbitrary app choice — but the original spec's intent was for that limit to trigger a *different upload method*, not a rejection.

---

## Goal

Recordings longer than ~40 minutes upload and transcribe successfully via the Gemini Files API (upload → wait for processing → transcribe by reference → delete), while recordings under the inline threshold keep working exactly as today (no change to the common case). Replace the hard 19MB ceiling with a much larger, sane app-level limit.

---

## Acceptance Criteria

- **Given** a recording's audio is at or under ~19MB (today's inline limit)
- **Then** transcription behaves exactly as today — no behavior change, no added latency
- **Given** a recording's audio is over ~19MB (a longer meeting) and under the new app-level ceiling
- **Then** the upload succeeds (not rejected at 413), and transcription is performed via the Gemini Files API: upload the audio file, poll until its state is `ACTIVE` (bounded wait), call `generateContent` with a `fileData` reference, then delete the uploaded file from Gemini regardless of success or failure
- **Given** the uploaded file's processing fails (`state: 'FAILED'`) or never becomes `ACTIVE` within the timeout
- **Then** the recording is marked `failed` with a clear Hebrew error (existing retry flow already supports re-running `processVoiceRecording`), and the temporary Gemini file is still deleted
- **Given** a recording exceeds the new app-level ceiling (pick a generous but bounded size — see Open Questions)
- **Then** the upload is still rejected with a clear message reflecting the new limit, not the old "19MB / 40 min" copy
- **Given** transcription of a large file is in progress
- **Then** the existing "uploaded → processing → completed/failed" status flow, retry button, and UI all work unchanged — this is purely a transcription-method change inside `processVoiceRecording`, not a new pipeline stage

---

## Backend Changes

### `packages/api/src/services/voice.ts`

- Rename the *inline/Files-API switch point* to its own constant (e.g. `GEMINI_INLINE_MAX_BYTES = 19 * 1024 * 1024`), kept exactly at today's value since that's a Gemini platform limit, not a product choice.
- `VOICE_MAX_BYTES` becomes a much larger overall app ceiling (see Open Questions for the exact number) — used only for sanity-checking uploads (disk/cost/absurd-file protection), not for choosing the transcription method.
- `transcribeWithGemini`: branch on `audio.length <= GEMINI_INLINE_MAX_BYTES`.
  - **At/under threshold:** unchanged — existing `inlineData` call.
  - **Over threshold:** `new GoogleAIFileManager(key).uploadFile(audio, { mimeType, displayName: 'ak-voice-recording' })` (the SDK's `uploadFile` accepts a `Buffer` directly, matching what this function already receives from `fs.readFileSync`), poll `getFile` every ~2s until `state !== 'PROCESSING'` or a bounded timeout elapses, then `generateContent([{ fileData: { fileUri, mimeType } }, { text: <same prompt> }])`, and always `deleteFile` in a `finally` block.
- New dependency import: `GoogleAIFileManager`, `FileState` from `@google/generative-ai/server` (already installed — `@google/generative-ai@0.24.1` ships this subpath; no `package.json` change needed).

### `apps/web/src/app/api/voice/upload/route.ts`

- Error copy updated to reflect the new, larger `VOICE_MAX_BYTES` instead of "19MB, כ-40 דקות".

---

## Out of Scope

1. Streaming/chunked upload of the audio file itself from the browser/mobile to the AK System server — the file still uploads to the server in one multipart request as today; only the *server → Gemini* leg changes.
2. Real-time/partial transcription while still recording — unchanged, transcription still happens after the full file is uploaded.
3. Raising Gemini's own inline-request limit — that's fixed by Google, not something this app controls; the Files API path is the correct workaround, not a threshold tweak.

---

## Open Questions

1. **New `VOICE_MAX_BYTES` ceiling:** needs a number. Candidates: a generous byte cap (e.g. 300MB, comfortably covering multi-hour meetings at typical encoding rates) or a duration-based cap mirroring the "2-hour soft cap / 3-hour hard stop" recommendation already floated in `voice-capture-deep-analysis.md`'s Open Questions. Recommend: keep it byte-based for simplicity (matches today's implementation style), set generously (e.g. 300MB) so it's effectively "never hit in practice" rather than a second wall the user runs into.
2. **Files-API processing timeout:** audio files typically process to `ACTIVE` in a few seconds, but needs a real bounded value (e.g. 60s) with a clear failure message if exceeded, rather than hanging the background job indefinitely.
3. **Cost/latency awareness:** Files API adds an upload + poll + delete round-trip versus a single inline call — negligible for occasional long recordings, worth knowing about if this becomes a very frequent path.

---

## Testing Notes

- Vitest: `transcribeWithGemini` — mock `GoogleGenerativeAI` and `GoogleAIFileManager`; assert inline path used at/under threshold, Files API path used above it (upload → poll → generateContent → delete called, including on failure), and that `deleteFile` is always called even when `generateContent` throws.
- Vitest: `saveVoiceUpload` no longer rejects a file between the old 19MB and the new ceiling; still rejects above the new ceiling.
- Manual QA: record (or import) something genuinely over 40 minutes end-to-end and confirm it transcribes and analyzes successfully.
