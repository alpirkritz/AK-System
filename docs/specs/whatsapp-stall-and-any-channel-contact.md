# WhatsApp stall warning + "quiet" means no contact on any channel

## Goal
1. The daily WhatsApp digest must not say "nothing happened" when the real cause is that no messages are arriving (bridge disconnected / webhook not landing).
2. Hugo's relationship "quiet" flag and the harness `silent_before_meeting` card must treat any contact as contact: meetings (group included), recordings, WhatsApp DMs, WhatsApp group messages, email, manual last-contact.

## Acceptance criteria
- Empty digest + (bridge `/status` says disconnected, or unreachable, or no group message stored in 24h) → the body is a ⚠️ warning with how long ago the last message arrived and the bridge error, and the title says no messages are coming in. Otherwise the quiet-day line is unchanged.
- `evaluateAttention`: `quietDays` counts from the last interaction on any channel. People seen only in groups are still never "quiet" unless a contact rhythm is set.
- `loadAttention` also reads WhatsApp group messages (sender JID → `whatsapp_person_links`) and `voice_recording_people`.
- `silent_before_meeting` uses that cross-channel last contact instead of WhatsApp DMs only.
- An acknowledged flag re-opens only on a new meeting (not on a group chat message).

## Data model / API
No schema or tRPC changes.

## Out of scope
Fixing the production bridge connection itself (needs re-pairing on EC2).
