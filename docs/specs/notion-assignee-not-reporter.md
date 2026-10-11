# Notion assignee is not Reporter

> **Slug:** `notion-assignee-not-reporter`
> **Status:** Approved
> **Stack:** `next-trpc-monorepo`

## Goal

When a pasted Notion task database has several people fields, sync must set `tasks.assigneeId` from the assignee field only. A task whose Notion Assignee is someone else must not become the owner's task just because the owner is Reporter, QA, or another people field.

## User stories

- As the owner, I want "Dev by Spec for Azorim" to stay assigned to Dor when Notion's Assignee is Dor and I am only the Reporter.
- As the owner, I want QA and Reporter to remain related people, so they still show on the person card without replacing the assignee.
- As the owner, I want a task whose Assignee is a stranger to stay out of my list even if I reported it.
- As the owner, I want databases that only have Owner or Assignee to keep syncing as they do today.
- As the owner, I want a write-back of the assignee to update Assignee, not the first people column in the schema.

## Acceptance criteria

- Given a page with Assignee = Alice, Reporter = Alpir Kritzler, and QA = Bob, when `syncNotionTasks` runs, then `assigneeId` is Alice, Bob is in `task_people`, and Alpir is not the assignee.
- Given a page with Assignee = an unknown person and Reporter = Alpir, when sync runs, then the task is skipped.
- Given a page whose only people field is Owner, when sync runs, then that person is still the assignee.
- Given a page with no assignee-named people field and a Person relation to a known person, when sync runs, then that person is still the assignee.
- Given a pasted database whose Assignee is a relation to Dor and whose Reporter people field is the owner, when sync runs, then `assigneeId` is Dor.
- Given a pasted database with no Assignee/Owner/אחראי column, Team = Alice and Watchers = the owner, when sync runs, then `assigneeId` is Alice.
- Given an Assignee relation to an unknown person and Reporter = the owner, when sync runs, then the task is skipped.
- Given a database whose people fields are QA, Reporter, then Assignee, when a task is created in Notion, then the people payload is written to Assignee.

## Data model

None.

## tRPC API

None. Existing `tasks.syncFromNotion` calls the updated service.

## UI surface

None. `/tasks` and the task modal already show `assigneeId`. After the next Notion sync, wrongly assigned rows are overwritten.

## Out of scope

- Changing which tasks appear in the 60-day window.
- Mapping Reporter into a new column.
- Re-syncing production from this change; the owner runs sync after deploy.

## Open questions

None.
