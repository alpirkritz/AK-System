/**
 * Hebrew copy for the result of pushing a task's related people to the Notion People relation.
 * Returns `null` when there is nothing worth telling the user — see the
 * notion-task-people-relation-push spec.
 */

export type PeopleSyncResult =
  | { ok: true; propertyName?: string; matched?: string[]; unmatched?: string[] }
  | { ok: false; reason?: string; message?: string; unmatched?: string[] }

/**
 * Latin names inside Hebrew text flip the surrounding punctuation unless each one is isolated.
 * U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE do that without adding glyphs.
 */
function isolate(name: string): string {
  return `\u2068${name}\u2069`
}

function nameList(names: string[]): string {
  return names.map(isolate).join(', ')
}

export function notionPeopleSyncMessage(sync: PeopleSyncResult | null | undefined): string | null {
  if (!sync) return null

  const unmatched = (sync.unmatched ?? []).filter(Boolean)

  if (sync.ok) {
    if (unmatched.length === 0) return null
    return `האנשים שויכו, אבל ${nameList(unmatched)} לא נמצאו בספריית האנשים ב-Notion`
  }

  // A task database can simply have no people relation (DAZ Tasks); nagging on every save is noise.
  if (sync.reason === 'no-people-relation') return null

  if (sync.reason === 'no-matching-people') {
    return unmatched.length > 0
      ? `${nameList(unmatched)} לא נמצאו בספריית האנשים ב-Notion, ולכן השיוך שם לא עודכן`
      : 'האנשים לא נמצאו בספריית האנשים ב-Notion, ולכן השיוך שם לא עודכן'
  }

  return 'האנשים נשמרו, אבל השיוך שלהם ב-Notion נכשל'
}
