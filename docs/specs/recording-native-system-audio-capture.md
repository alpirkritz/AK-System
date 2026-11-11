# Native macOS Helper App for System Audio Capture (Notion/Granola-style)

**Stack:** new — a native macOS app/helper, outside the current Next.js/Expo monorepo tooling
**Slug:** `recording-native-system-audio-capture`
**Status:** Backlog (future — not scheduled; written for reference when this becomes a priority)
**Created:** 2026-09-30
**Supersedes-in-ambition:** `recording-call-audio-capture.md` (the BlackHole/loopback-driver spec), which ships first as the near-term unblock. This spec is the "do it properly, like Notion" follow-up.

---

## Why this is a separate, bigger spec

`recording-call-audio-capture.md` gets call recording working today using a free virtual-audio-driver workaround (BlackHole + a Multi-Output Device), because a **web page** cannot capture system audio on macOS — Chrome/Safari don't expose that capability to web content, full stop, regardless of how the AK System web app's code is written.

Notion's meeting-notes feature, Granola, Fireflies desktop, and Otter desktop all avoid this limitation because they are **native macOS apps**, not websites. Since macOS Sonoma (14.2), Apple ships a public API for exactly this — Core Audio's "process tap" capability (`AudioHardwareCreateProcessTap` / `CATapDescription`), paired with a new permission category in System Settings → Privacy & Security → **System Audio Recording**. A native app can request that permission once, then capture the system's audio output directly — no virtual driver, no manual Multi-Output Device setup, no losing your normal speaker routing. This is the real "how does Notion do it."

Building this means adding a genuinely new component to the project: a small native macOS app (Swift, not TypeScript/React), which is a different toolchain, a different distribution story (code signing, notarization, possibly a `.app` outside the App Store or a lightweight menu-bar-only build), and ongoing maintenance the rest of this monorepo doesn't currently have. That's why it's scoped as its own backlog item rather than folded into the web recorder work.

---

## Goal (when this gets picked up)

A menu-bar helper app that: detects (or lets you manually start) a recording session, captures system audio via the macOS process-tap permission plus the microphone, and hands the result to AK System exactly like today's web/mobile recordings do — same transcription, analysis, calendar auto-matching (`recording-auto-calendar-context.md`) and meeting-linking pipeline, just a different capture front-end.

---

## User Stories

1. **As a user**, I want to grant a single macOS permission once (System Audio Recording) instead of installing/configuring a virtual audio driver, so call recording feels as effortless as Notion's.
2. **As a user**, I want the helper to sit in the menu bar and let me start/stop a recording with one click (or auto-start based on a calendar event, echoing the auto-attach logic already built for the web/mobile recorder), without opening a browser tab.
3. **As a user**, I want the recording — once stopped — to upload straight into AK System and show up in the same meetings/recordings UI I already use, not a separate silo.
4. **As a user**, I want my own microphone and the call's system audio mixed into one recording, same as today's browser-based capture, so the transcript reads as one conversation.
5. **As a user**, I want a clear one-time permission flow (macOS will show its own system dialog) with in-app guidance if I fumble it or need to re-grant it after an OS update.

---

## Acceptance Criteria (sketch — to firm up when scheduled)

- **Given** the helper app is freshly installed and I click "Record"
- **Then** macOS prompts for System Audio Recording permission (and microphone permission, standard) if not already granted, with in-app copy explaining why both are needed
- **Given** permission is granted
- **When** I start a recording
- **Then** system audio (all app output, not just one call app) and my microphone are captured and mixed locally, matching today's mic-only recording's format/quality expectations
- **Given** a recording finishes
- **Then** it uploads to the same `/api/voice/upload` endpoint (or a new equivalent) the web/mobile clients already use, so the rest of the pipeline (transcription, analysis, calendar auto-match) needs no changes
- **Given** I'm in a calendar meeting (per the existing Google Calendar sync) when I start a recording
- **Then** the same auto-match logic from `recording-auto-calendar-context.md` applies — this helper is a new *capture* front-end, not a new *linking* mechanism
- **Given** permission is revoked or unavailable (e.g. macOS version below Sonoma 14.2)
- **Then** the helper explains the OS requirement clearly and points to the BlackHole-based web recorder as a fallback

---

## Open Questions (substantial — this needs real scoping before estimating)

1. **Distribution:** unsigned/local-only build the user runs themselves (simplest, no Apple Developer Program cost, but Gatekeeper friction on every update) vs. a signed + notarized build (smoother, requires an Apple Developer account and a code-signing/notarization step in the release process — new CI concern) vs. eventually the Mac App Store (most friction, sandboxing may conflict with the process-tap API's entitlement requirements — needs verification).
2. **Minimum macOS version:** the process-tap API requires Sonoma 14.2+; need to decide whether to support older macOS via a BlackHole fallback baked into the same app, or just require 14.2+ and point pre-14.2 users at the web+BlackHole path from `recording-call-audio-capture.md`.
3. **Auto-start on calendar meetings:** should the helper watch the calendar and offer/auto-start recording near a meeting's start time (more Notion-like), or stay manual-start only for v1? Auto-start raises its own consent/privacy questions (recording without an explicit per-session click) that the existing consent-screen pattern in `voice-capture-deep-analysis.md` was built around — needs a compatible design, not a bypass of it.
4. **Upload mechanism:** reuse the existing multipart `/api/voice/upload` route as-is, or does a long-running system-audio capture need chunked/resumable upload (a Zoom call can run an hour+, same size concerns as today's mobile background-recording spec)?
5. **Packaging/build tooling:** this needs Xcode/Swift tooling that doesn't exist anywhere else in this pnpm/Turbo monorepo today — decide whether it lives in a new top-level directory (e.g. `apps/macos-helper/`) with its own build process wired into `tools/agent-pipelines` conventions, or stays a fully separate repo.
6. **Should it also handle non-call, everyday recordings** (replacing the web recorder entirely on Mac), or stay scoped specifically to "capture system audio during a call," leaving normal in-person recording to the existing web/mobile flow?

---

## Out of Scope (for this backlog spec, until scheduled)

- Windows/Linux equivalents (a different native API per OS; not pursued unless macOS version proves out)
- Any App Store submission process
- Speaker diarization changes — reuses the existing pipeline from `recording-background-and-speaker-id.md` unchanged
- Building this before the near-term `recording-call-audio-capture.md` (BlackHole/device-picker) fix ships — that one is scoped, approved, and materially cheaper for the same immediate pain (Zoom calls not being captured)

---

## When to Revisit

Pick this up if the BlackHole/loopback-driver workaround from `recording-call-audio-capture.md` proves too fiddly in daily use (manual Multi-Output Device juggling, users forgetting to switch output devices back), or if call recording becomes frequent enough that the one-time Swift/Xcode investment clearly pays for itself in reduced friction.
