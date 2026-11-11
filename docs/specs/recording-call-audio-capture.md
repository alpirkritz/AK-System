# Capturing Both Sides of a Remote Call (Zoom/Meet/Teams) in Web Recordings

**Stack:** `next-trpc-monorepo` (backend minimal) + `apps/web` (browser recorder)
**Slug:** `recording-call-audio-capture`
**Status:** Draft
**Created:** 2026-09-30
**Triggered by:** live bug report — recording during a Zoom call, the level meter never moved when the other two participants spoke, and (correctly) neither did their voices get recorded.

---

## Why this happens today (root cause, not a bug)

`apps/web/src/app/voice/lib/use-recorder.ts` calls `navigator.mediaDevices.getUserMedia({ audio: true })` — this captures **only the physical microphone input**, and the level meter (`AnalyserNode`) is wired to that exact same stream. It has no connection to Zoom, Meet, Teams, or any other app's audio. Whether other participants end up "in" the recording at all depends entirely on whether the microphone can *acoustically* hear them:

- **Headphones/earbuds in the call:** the other side's audio goes straight to your ears and never reaches the room's air — the mic cannot hear them, so they are not recorded at all. This is almost certainly what happened.
- **Speakers (no headphones):** the mic picks up their voices as acoustic bleed from the speakers — noisy, echo-prone, and highly dependent on mic placement/volume, but present.

This is standard browser-sandboxing behavior (a web page cannot read another application's audio without one of the mechanisms below) — not something fixable by tweaking the current recorder's settings.

---

## Platform reality check (read before scoping — this determines what's actually buildable)

Three distinct mechanisms exist for a browser to capture audio it isn't physically hearing, each with real constraints:

1. **Tab audio capture** (`getDisplayMedia` sharing a specific *browser tab*): works cross-platform in Chromium browsers, **but only if the call itself runs inside a browser tab** (e.g. Google Meet, or Zoom's web client) — not the Zoom **desktop app**, which isn't a tab.
2. **System/screen audio capture** (`getDisplayMedia` sharing "Entire Screen" with audio): captures whatever the OS is playing, regardless of source app — **but Chrome only exposes this on Windows and ChromeOS. On macOS (and Linux), Chrome's screen-share audio option does not exist / captures no audio at all** — this is an OS-level restriction Chrome cannot route around, not a missing feature Chrome could ship. Safari has no equivalent API. Alpir's desktop is a Mac, so this path is a dead end for the Zoom-desktop-app scenario that triggered this.
3. **Virtual loopback audio device** (OS-level, outside the browser): a driver (e.g. BlackHole, Rogue Amoeba's Loopback — free/paid, macOS) that duplicates whatever the system plays into a virtual "microphone" input. Point Zoom's speaker output and a macOS **Multi-Output Device** (built into Audio MIDI Setup, combines real speakers + the virtual driver) so the user still hears the call live while it's simultaneously routed to the virtual input. The browser then just does an ordinary mic capture — of the virtual device instead of the real one. This works regardless of which app is making the sound (Zoom desktop, Meet, Teams, a phone call through the Mac), which is why it's the only option that actually solves *this* scenario — but it requires a one-time OS-level install/setup outside the app, which today's recorder gives the user no way to even select (see below).

**Conclusion for this spec:** for Alpir's actual setup (Mac, Zoom desktop app), option 3 (loopback device) is the only mechanism that works at all. Options 1–2 are still worth adding as a secondary path for calls that *do* run in a browser tab (Meet) or for a future Windows user, since they need no OS install — but they will not fix today's specific complaint.

---

## Goal

1. Let the recorder target a **specific input device** (not just "the OS default mic"), which is the missing piece that blocks the loopback-driver approach entirely today.
2. Add an in-app, one-time setup guide for the loopback-driver approach on Mac, so a recording made during a Zoom/Meet/Teams call captures both sides.
3. Where the call runs in a Chrome tab (e.g. Meet) or on a platform where screen/tab audio capture is actually available, offer that as a no-install alternative.
4. When two audio sources are active (mic + loopback, or mic + tab/system audio), mix them into one recorded track so the file contains a complete conversation, and the existing level meter reflects the mixed signal.

---

## User Stories

1. **As a user**, I want to choose which audio input the recorder uses (not just whatever the OS default mic is), so I can point it at a virtual loopback device that carries the call audio.
2. **As a user**, I want a short in-app guide for setting up a Mac loopback device once, so future call recordings capture everyone without repeating research each time.
3. **As a user**, when I record a Google Meet call running in a Chrome tab, I want the option to capture that tab's audio directly, with no OS-level setup.
4. **As a user**, I want the recording to contain my own voice too, not just the loopback/tab audio, so the conversation makes sense start to finish.
5. **As a user**, I want the level meter and any "is anyone talking" feedback to reflect the actual mixed signal being recorded, so I can tell during the call whether capture is really working — this is exactly the signal that was missing and prompted this spec.
6. **As a user**, when neither a loopback device nor tab/system audio capture is available (e.g. I didn't set up BlackHole and the call isn't in a tab), I want a clear inline message saying so — not a silently mic-only recording that looks the same as a working one.

---

## Acceptance Criteria

### Device Picker
- **Given** I open the recording screen
- **Then** I see a device selector (populated via `navigator.mediaDevices.enumerateDevices()`, labeled once permission has been granted at least once) defaulting to the OS default input, with my last choice remembered for next time (local storage, per-browser — not synced, not a server setting)

### Loopback Setup Guide
- **Given** I've never recorded a call before (or click "הגדרת הקלטת שיחה" from the recorder)
- **Then** I see a short guide: install BlackHole (or Loopback), create a Multi-Output Device combining it with my speakers in Audio MIDI Setup, set that as system output (or Zoom's output) during calls, and select the virtual device in the recorder's device picker above
- This is documentation/UI only — the app cannot install OS-level audio drivers itself

### Tab Audio Mode (secondary path)
- **Given** the browser supports `getDisplayMedia` with audio (feature-detected) and I choose "הקלטת אודיו מהטאב/מהמסך" instead of a microphone device
- **When** I pick a tab or screen to share
- **Then** that source's audio is captured and mixed with my microphone (see Mixing below); if the browser/OS only supports video-less audio-share for a *tab* (not a full screen, e.g. macOS Chrome), the UI only offers the tab option and explains why screen audio isn't offered on this OS
- **Given** the user cancels the share picker, or the browser doesn't support audio in `getDisplayMedia` at all (Safari, Firefox)
- **Then** the option is hidden/disabled with an inline explanation, and the recorder falls back to mic-only as today

### Mixing
- **Given** a non-default input device or tab/screen audio source is active alongside the microphone
- **Then** both `MediaStream`s are connected to a shared `AudioContext` and merged into one `MediaStreamDestination`, and `MediaRecorder` records that merged stream — not two separate files
- **Given** only the microphone is active (today's default, nothing changed)
- **Then** behavior is byte-for-byte identical to today (no regression for the common non-call recording case)

### Level Meter Reflects Reality
- **Given** any of the above capture modes is active
- **Then** the existing bar-level meter is driven by the same merged/selected stream that's actually being recorded — so if it isn't moving, that's an accurate signal that audio isn't being captured, addressing the exact confusion that triggered this spec

### No Silent Failure
- **Given** the user selects "capture the call too" (loopback device or tab audio) but the selected device/source turns out to carry no audio (e.g. wrong device picked, Multi-Output not actually set as system output)
- **Then** after a few seconds of recording with zero signal on that source, an inline warning appears ("לא מזוהה אודיו ממקור השיחה — ודא/י שהתקנת את ההתקן הנכון") rather than completing a recording that silently only has the user's own voice

---

## Data Model Changes

None server-side. The chosen input device id and "capture mode" (mic-only / mic+loopback-device / mic+tab-audio) are stored client-side (`localStorage`), consistent with this being a per-browser/per-machine hardware preference, not a user-account setting synced across devices.

---

## Backend Changes

None. This is entirely a browser-side capture change in `apps/web/src/app/voice/lib/use-recorder.ts` (and the equivalent recording UI in `apps/web/src/app/voice/page.tsx`). The upload/transcription/analysis pipeline is unaffected — it already just receives a single audio blob, however many sources fed it.

---

## UI Surface

### `apps/web/src/app/voice/page.tsx` (recording screen, pre-start)

- New device-selector dropdown above the record button, and a secondary "הקלטת אודיו מהטאב/מהמסך" toggle (shown only when supported)
- "איך מקליטים שיחת זום/Meet במלואה?" link opening the setup guide (a static help panel/modal, in-app — no new page needed)

### During recording

- No visual change beyond the level meter now reflecting the real (possibly merged) signal

---

## Out of Scope

1. **Mobile.** Capturing another app's audio on Android (`MediaProjection` + `AudioPlaybackCapture`, API 29+) is a materially different, higher-effort mechanism (foreground service, explicit per-session consent, and many call apps opt out of allowing capture at all) and isn't what triggered this report (a desktop Zoom call). Candidate for a future spec if mobile call recording becomes a real use case.
2. **Automatically detecting** that a call is in progress and auto-suggesting the loopback/tab mode — this spec only makes the capability selectable; smarter defaults can follow later.
3. **Server-side mixing or post-processing** — mixing happens client-side before upload, as today.
4. **Any change to transcription/diarization** — out of scope, unrelated to capture source.
5. **Windows/ChromeOS-specific system-audio-capture polish** — the tab-audio path is included since it's cheap and platform-agnostic, but full "entire screen" system audio (which *does* work on Windows) isn't specifically tuned for in this pass; it should still work via the same `getDisplayMedia` code path and can be verified opportunistically.

---

## Open Questions

1. **Which loopback driver to recommend:** BlackHole (free, macOS-only, no GUI mixer) vs. Rogue Amoeba's Loopback (paid, macOS-only, nicer multi-source mixing UI). Recommend documenting BlackHole as the default (free) with a one-line mention of Loopback as the "nicer, paid" alternative.
2. **Zero-signal detection threshold/timing** for the "no audio from call source" warning — needs a couple of real test recordings to tune, similar to the open threshold question in `recording-background-and-speaker-id.md`.
3. **Should the mobile app (Android) get a stripped-down version of this** (e.g. just exposing input-device selection, without playback capture) given the Z Fold 7 is Alpir's phone and could plausibly join calls too? Leaning no for v1 given this was specifically a desktop/Zoom report.
4. **Persisting the device choice**: local storage is proposed (per-browser), but should it be remembered per capture-mode (mic-only vs. call-recording) so switching back and forth doesn't require re-selecting each time?

---

## Testing Notes

- Manual QA (no automated coverage possible for real hardware/OS audio routing): set up BlackHole + a Multi-Output Device on the actual Mac, record a real Zoom call, verify both sides are audible in the resulting transcript.
- Manual QA: Google Meet in a Chrome tab, use the tab-audio option, verify both sides captured without any OS-level setup.
- Manual QA: default mic-only path unchanged — record a normal in-person conversation, verify no regression.
- Manual QA: select a loopback device that isn't actually receiving audio (Multi-Output not set as output) — verify the "no audio detected" warning appears rather than a silently incomplete recording.
- Vitest (limited scope — most of this is unmockable browser/OS behavior): the `AudioContext` merge-graph construction logic (given N input `MediaStream`s, produces one merged stream) can be unit-tested with a mocked Web Audio API.
