# whatsapp-digest-story-prompt — pre-implementation UI/UX review

Reviewed `docs/specs/whatsapp-digest-story-prompt.md` UI Surface before implementation.

## UI/UX Review

**Verdict:** APPROVED
**Detected stack:** next-trpc-monorepo

### Design System Checklist
- [x] Matches project tokens/classes (`.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.input`, `.modal`, `.overlay`)
- [x] RTL layout preserved (`dir="rtl"` on the textarea, Hebrew microcopy)
- [x] Mobile layout works (card under the existing wrapping toolbar; no new route)
- [x] No unapproved UI frameworks introduced
- [x] Reuses the WhatsApp settings page and its existing message banner

### UX Quality Checklist
- [x] Clear visual hierarchy — the editor is closed by default, so the groups list stays the primary surface
- [x] Cognitive load minimized — one disclosure, one field, save and reset
- [x] All feedback states handled (loading / empty-as-too-short / error / success)
- [x] Destructive reset requires confirmation
- [x] Microcopy: clear Hebrew, verb-first buttons, human errors
- [x] Touch targets use existing `.btn` sizing; textarea has a visible label and `aria-label`

### Findings
- Must-fix: none.
- Nits: none that should change the spec. The Groups tab already has two `.btn-primary` controls in the toolbar (`סכם עכשיו…`, `רענון מ-WhatsApp`). The new save button is inside the disclosure, so the default view does not add a third gold action.

### Decisions recorded in the spec
- Edit the digest on `/settings/whatsapp`, not on `/agents/manage`. The digest is a scheduled briefing, and the button that runs it already lives on this page.
- The field edits tone only. Today's messages and the JSON shape stay off the screen, so a wording change cannot break parsing.
- Quiet groups are dropped by the renderer and are never sent to the model. The prompt says the same thing, but the omission does not depend on the user keeping that sentence.
