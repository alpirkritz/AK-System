# Chunked Transcription for Long Recordings

**Stack:** `next-trpc-monorepo` (backend)
**Slug:** `voice-chunked-long-transcription`
**Status:** Implemented
**Created:** 2026-10-18
**Follows:** `voice-large-recording-transcription.md` (Gemini Files API for recordings over the ~19MB inline limit) — that spec made long recordings *uploadable*; this one makes very long recordings *transcribe reliably*.

---

## Why this is happening

A user recorded a meeting a little over an hour long. It uploaded and reached the Files API path fine, but transcription failed with:

```
[GoogleGenerativeAI Error]: Text not available. Response was blocked due to OTHER
```

`transcribeWithGemini`/`transcribeViaFilesApi` ask Gemini, in **one request**, to return a full speaker-attributed JSON transcript (`[{"speaker":"דובר 1","start":0,"end":4.2,"text":"..."}]`) for the **entire** recording. For a hour-plus conversation this is a large, structurally complex JSON object. In practice the response sometimes comes back with `finishReason: 'OTHER'` and no usable text at all — most likely the response approaching an internal output-size/complexity limit, though Google doesn't document the exact cause of `OTHER`. `result.response.text()` throws the SDK's own English message in this case, which is what reached the user verbatim — not a helpful error, and not actionable.

---

## Fix

### 1. Clear error instead of the raw SDK string

`readTranscriptionText()` wraps `result.response.text()`; on throw, it reads `result.response.candidates?.[0]?.finishReason` and raises a Hebrew error naming the finish reason, in both the inline and Files API paths.

### 2. Root cause: split long recordings into chunks

`VOICE_CHUNK_THRESHOLD_SECONDS` (default 45 min): recordings longer than this are transcribed by `transcribeLongRecordingWithGemini` instead of a single `transcribeWithGemini` call:

1. Split the audio into `VOICE_CHUNK_DURATION_SECONDS`-long pieces (default 20 min) with `ffmpeg -ss <start> -t <len> -c copy` (stream copy — audio splits cleanly this way, no re-encode needed).
2. Transcribe each chunk independently through the existing `transcribeWithGemini` (so each chunk still gets the inline-vs-Files-API choice for free, and a 20-minute chunk is small enough that the JSON-size issue above shouldn't recur).
3. Reconcile each chunk's turns back onto the full recording:
   - **Timestamps:** shift every turn's `start`/`end` by the chunk's offset in the original file.
   - **Speaker labels:** Gemini numbers "דובר 1/2/…" independently per request, so chunk 2's "דובר 1" is not necessarily the same person as chunk 1's. `GlobalSpeakerRegistry` reuses the existing self-voice-matching heuristic (`audio-features.ts`'s log-mel voiceprint + cosine similarity, same approach as `voice-diarization.ts`'s self-voice detection): for each chunk, pool the VAD-segment embeddings that overlap each raw label's turns into one voiceprint per label, then match it against voiceprints already seen in earlier chunks (`VOICE_CHUNK_SPEAKER_MATCH_THRESHOLD`, default 0.75) before assigning a stable global "דובר N" label.
4. A chunk whose response isn't parseable JSON keeps its raw text as a single unattributed turn rather than being dropped; a chunk whose voiceprint extraction fails (ffmpeg/decode error) still keeps its text, just without cross-chunk label matching for that chunk's speakers.
5. The temp directory holding the chunk audio files is always removed (`finally`), success or failure.

Recordings at or under the threshold are completely unaffected — same single-request path as before.

---

## Known limitations / possible follow-ups

- Chunk boundaries are not overlapped, so a sentence that straddles exactly a chunk boundary may be split (or very rarely lose a word or two) in the transcript. Not addressed here — would need overlapping chunks plus de-duplication logic.
- Cross-chunk speaker matching uses the same hand-rolled spectral-similarity heuristic as self-voice detection (see `audio-features.ts`'s header for its accuracy caveats), not a trained speaker-embedding model. For conversations with more than ~3-4 distinct voices, or very similar-sounding voices, mismatches are possible at chunk boundaries.
- `packages/api/src/services/gemini-gateway.ts` (rate limiting, circuit breaker, retry/backoff) exists but `voice.ts` calls the Gemini SDK directly and does not go through it — chunking does not change this; each chunk is still an un-gated direct call. Worth a separate look if long recordings start hitting rate limits in practice (more chunks = more requests per recording).
