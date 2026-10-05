# Reviewer Report: recording-call-audio-capture

**Verdict: APPROVED WITH NITS** (pending a local `pnpm test`/`build` run — same sandbox limitation as the previous feature, see QA Gate)

## What changed

Implements `docs/specs/recording-call-audio-capture.md` — the near-term (non-native) fix for the live bug: the web recorder captured only the physical microphone, so a Zoom call over headphones was never actually recorded on the "call" side, and the level meter (wired to the same mic-only stream) accurately showed nothing happening.

- `apps/web/src/app/voice/lib/use-recorder.ts`:
  - Input device picker: `enumerateDevices()`-backed list, `deviceId: { exact }` constraint on `getUserMedia`, persisted to `localStorage` (`ak-voice-input-device-id`) — this is what makes a loopback device (BlackHole etc.) usable at all, which was the actual blocker before this change.
  - New `captureMode: 'mic' | 'tab'`, persisted the same way. In `'tab'` mode, `getDisplayMedia({ video: true, audio: true })` grabs a shared tab/screen's audio (video track dropped immediately), mixed with the mic via a `GainNode` bus into a `MediaStreamDestination`, which is what `MediaRecorder` actually records. Mic-only mode is untouched — `MediaRecorder` still gets the raw device stream directly, no new indirection, no risk of regressing the existing (non-call) recording path.
  - The level meter now analyses whichever stream is actually being recorded (merged bus in tab mode, selected device otherwise) instead of always the raw mic — directly fixes the "meter doesn't move" confusion that triggered this.
  - A dedicated silence check (`SILENCE_THRESHOLD` / `SILENCE_GRACE_MS`) watches the call-audio track (tab mode) or the explicitly-selected device (loopback mode) for ~4 seconds and flips `noCallSignal` if nothing crosses the threshold — surfaced as an inline warning rather than a recording that silently turns out mic-only.
- `apps/web/src/app/voice/page.tsx`: device `<select>`, a "גם הקלטת אודיו מטאב/מסך משותף" checkbox (only shown when `getDisplayMedia` is feature-detected), an in-app collapsible guide covering both paths (BlackHole + Multi-Output Device for standalone apps like Zoom desktop; the tab-audio checkbox for browser-based calls like Meet), and the `noCallSignal` warning banner during active recording.
- `docs/specs/recording-native-system-audio-capture.md` (new, Status: Backlog): the "do it properly" native macOS helper app path (Notion/Granola-style, using Apple's Sonoma 14.2+ System Audio Recording permission) — written for future reference per your decision to ship the quick fix now and defer the bigger native build.

## Scope note

Mic-only recording (the common, non-call case) is unchanged in code path and behavior — `MediaRecorder` still receives the device stream directly with no `AudioContext` round-trip, exactly as before this change, satisfying the spec's "no regression" acceptance criterion. Only `'tab'` mode or an explicitly-chosen non-default device engage the new mixing/silence-check logic.

## QA Gate

- `pnpm -r run lint` (`next lint` on `apps/web`): **ran clean** — identical warning list to the pre-existing baseline (same files/lines as before this change); nothing new in `use-recorder.ts` or `voice/page.tsx`.
- `pnpm test` / `pnpm --filter @ak-system/web build`: **not run**, same sandbox constraint as the previous feature's QA gate (native `better-sqlite3`/`esbuild` binaries in `node_modules` are macOS arm64, this session is Linux; reinstalling in place was avoided to protect your local Mac setup). This change has no automated test coverage of its own since it's almost entirely real browser/OS audio-hardware behavior (`getUserMedia`/`getDisplayMedia`/`AudioContext` with real devices) — not meaningfully unit-testable without a live browser and real audio hardware. Verification here was manual code review; **real verification needs an actual test recording** (see below).
- **Recommendation:** before relying on this for a real call, do one test recording with an intentionally-connected loopback device (or a Meet tab) and confirm the transcript picks up both sides.

## What this does *not* fix

For your exact triggering scenario (Zoom **desktop app**, not a browser tab) this still requires the one-time BlackHole + Multi-Output Device setup described in the in-app guide — there is no way for a website to avoid that on macOS, which is exactly why `recording-native-system-audio-capture.md` exists as the eventual "no setup needed" path.
