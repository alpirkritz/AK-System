# Release notes email on every deploy

> **Slug:** `release-notes-email`
> **Status:** Approved — implemented
> **Last Updated:** 2026-11-02

## Goal

After each `pnpm deploy:ec2` the owner receives one well-designed Hebrew email that says what changed in this release, in product language, so he knows what to look at and whether anything needs his action.

## User Stories

- As the owner, I want a mail after every deploy listing what is new, improved and fixed.
- As the owner, I want to be told when something needs my action (a new APK, a manual database step, a setting).
- As the owner, I want the mail even if the summary service is down.
- As the owner, I want a copy of every release kept, so I can look back.

## Acceptance Criteria

- [ ] `deploy-ec2.sh` runs the release-notes step after a successful deploy. A failure in it never fails or rolls back the deploy.
- [ ] The range is "commits since the last deployed commit" (stored in `deploy/.last-deployed-sha`); without a stored value, the last 10 commits. The stored value is updated only after the deploy succeeded.
- [ ] Commit subjects and bodies and changed file names (never file contents) are summarised into Hebrew sections: חדש, שופר, תוקן, מאחורי הקלעים, plus an optional "דורש פעולה" box. If the summary service fails or times out, the mail is built from the commit subjects instead.
- [ ] The mail is RTL HTML with inline styles (header in the app's turquoise, section badges, readable in light and dark clients) with a plain-text alternative, and a footer listing the commits (short hash, subject).
- [ ] If the working tree has uncommitted changes to tracked files, the mail says so, since the deploy ships the tree and not the commit.
- [ ] Sent through Mail.app on the Mac (AppleScript), to `RELEASE_NOTES_TO` (default alpirkritz@gmail.com). No credentials are stored.
- [ ] A copy of the HTML and text is saved under `deploy/releases/` (git-ignored).
- [ ] `node scripts/release-notes.mjs --dry-run` builds and saves the notes without sending; `--since <sha>` overrides the range; `RELEASE_NOTES=0` skips the step.

## Data Model / API / UI

None. Script `scripts/release-notes.mjs`, hook in `scripts/deploy-ec2.sh`.

## Out of scope

Mail to anyone but the owner; in-app release-notes page; versioned changelog files in the repo.

## Open questions

None.
