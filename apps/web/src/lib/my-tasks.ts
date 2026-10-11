/** A task is "mine" only when its assignee is the owner. Related people do not count. */
export function isMyTask(
  assigneeId: string | null | undefined,
  selfId: string | null | undefined,
): boolean {
  return !!selfId && assigneeId === selfId
}
