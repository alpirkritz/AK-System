/** Build a notion.so page URL from a raw Notion page id (dashed or not). */
export function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`
}
