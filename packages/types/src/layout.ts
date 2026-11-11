/** Saved arrangement of the blocks on one screen. Ids are stable strings defined in code. */
export interface ScreenLayout {
  order: string[]
  hidden: string[]
  /** Blocks the owner left collapsed (meetings timeline sections). */
  collapsed?: string[]
}

export const LAYOUT_SCREENS = ['dashboard', 'person', 'meetings'] as const
export type LayoutScreen = (typeof LAYOUT_SCREENS)[number]
export type LayoutPrefs = Partial<Record<LayoutScreen, ScreenLayout>>

/**
 * The blocks to show, in order. Saved order first; blocks the code ships later (not in the saved
 * order) follow in their default order; saved ids that no longer exist are dropped; hidden ones
 * are split out so the screen can offer to bring them back.
 */
export function applyLayout(
  defaultIds: readonly string[],
  saved: Pick<ScreenLayout, 'order' | 'hidden'> | null | undefined,
): { visible: string[]; hidden: string[] } {
  const known = new Set(defaultIds)
  const hiddenSet = new Set((saved?.hidden ?? []).filter((id) => known.has(id)))
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of saved?.order ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  for (const id of defaultIds) if (!seen.has(id)) ordered.push(id)
  return { visible: ordered.filter((id) => !hiddenSet.has(id)), hidden: ordered.filter((id) => hiddenSet.has(id)) }
}
