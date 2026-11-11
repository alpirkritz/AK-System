# WhatsApp Bridge Capture Recovery
> **Slug:** `whatsapp-bridge-capture-recovery`
> **Status:** Approved — user requested repair and immediate deployment
> **Last Updated:** 2026-10-23

## Goal
Restore reliable WhatsApp group capture so group summaries use stored messages and FOMO evaluates live messages. Diagnose the live bridge before changing behavior, correct only the verified break in the bridge-to-AK capture path, and deploy the repaired service with a post-deploy operational verification.

## User Stories
- As the owner, I want group summaries to reflect messages that exist in my watched WhatsApp groups.
- As the owner, I want FOMO alerts to evaluate watched-group activity after bridge restarts and deployments.
- As the owner, I want a deployment to re-establish the bridge configuration and verify that the running bridge is connected and watching the same enabled groups as the database.

## Acceptance Criteria
- [ ] Live diagnostics identify whether the bridge is running, paired, configured with watched groups, and successfully posting captured messages to AK.
- [ ] A verified configuration, routing, persistence, or capture defect is fixed without weakening bridge authentication or the explicit watched-group privacy boundary.
- [ ] The fix has focused automated coverage for the corrected behavior where code changes are required.
- [ ] After deployment, the bridge reports connected, a nonzero watched-group count matching enabled DB groups, and no bridge-to-AK configuration error.
- [ ] Group summary requests use persisted messages after new watched-group activity, and FOMO remains enabled for groups configured for it.

## Data Model
No planned schema changes. Existing `whatsapp_groups` remains the watch/FOMO source of truth and `whatsapp_messages` remains the persisted summary source.

## tRPC API
No planned API shape changes. Existing protected `whatsapp.connection.status`, `whatsapp.sync.status`, `whatsapp.messages.stats`, and `whatsapp.insights.*` procedures provide diagnostics and summary behavior.

## UI Surface
No planned UI changes. Existing WhatsApp settings and chat summary requests should recover through backend/bridge repair.

## Out of Scope
- Backfilling WhatsApp messages that were never delivered to the bridge or retained in WhatsApp history.
- Changing FOMO thresholds, cooldowns, Gemini prompts, or group-selection settings unless diagnostics prove one is malformed.
- Expanding message retention or relaxing authentication/privacy controls.

## Open Questions
None. Live diagnostics determine the minimal repair.
