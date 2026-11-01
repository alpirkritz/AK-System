/** Pages served without a session: Google's OAuth consent screen needs a public homepage and privacy policy. */
const PUBLIC_PAGE_PATHS = ['/about', '/privacy']

export function isPublicPagePath(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return PUBLIC_PAGE_PATHS.includes(clean)
}
