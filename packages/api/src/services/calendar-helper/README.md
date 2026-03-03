# calendar-helper

A Swift EventKit helper that reads local macOS Calendar events without
triggering Exchange server sync (< 2 seconds vs 5+ minutes with osascript/JXA).

## Build

```bash
# From the repo root:
swiftc packages/api/src/services/calendar-helper/main.swift \
       -o packages/api/src/services/calendar-helper/calendar-helper
```

On first run, macOS will prompt for Calendar access. Approve it once.

## Usage

```bash
./calendar-helper --start 2026-03-01T00:00:00Z --end 2026-03-08T00:00:00Z
```

Outputs a JSON array of events.
