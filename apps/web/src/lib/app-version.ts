/** "גרסה 3 · a1b2c3d" for a deployed build; "גרסת פיתוח" when the build was not made by a deploy. */
export function formatAppVersion(release?: string | null, commit?: string | null): string {
  const n = release?.trim()
  if (!n || !/^\d+$/.test(n)) return 'גרסת פיתוח'
  const c = commit?.trim()
  return c ? `גרסה ${n} · ${c}` : `גרסה ${n}`
}
