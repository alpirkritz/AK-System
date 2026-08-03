import { CATEGORY_FALLBACK } from '@ak-system/types'

/**
 * Single source of categorization for `finance_transactions`.
 *
 * Replaces the two verbatim copies of `categorize()` that lived in csv-parser.ts and
 * pdf-parser.ts. Used by CSV/PDF import, bank sync, and the retroactive backfill.
 *
 * Two layers, user rules first:
 *   1. rules from `finance_category_rules` (learned from the user correcting a category)
 *   2. the built-in keyword table below
 */

export type TxnDirection = 'income' | 'expense'

export interface CategoryRule {
  pattern: string
  category: string
  direction?: TxnDirection | null
}

interface KeywordRule {
  category: string
  re: RegExp
  /** Restrict the rule to one direction; omitted = both. */
  direction?: TxnDirection
}

/**
 * Order is significant — the first match wins. Salary is checked before generic
 * transfers so that "העברת משכורת" is income rather than an internal movement, and the
 * credit-card rule sits high because a card charge must never be read as a purchase.
 */
const KEYWORD_RULES: readonly KeywordRule[] = [
  { category: 'משכורת', re: /משכורת|שכר עבודה|salary|payroll/, direction: 'income' },
  { category: 'כרטיס אשראי', re: /כרטיס אשראי|כ\.אשראי|ויזה|ישראכרט|מאסטרקארד|מסטרקארד|לאומי קארד|דיינרס|כאל|מקס איט|max it/ },
  { category: 'משכנתא', re: /משכנתא|משכנת/ },
  { category: 'הלוואות', re: /הלוואה|הלואה|החזר הלוו/ },
  { category: 'חיסכון והשקעות', re: /פקדון|פיקדון|חסכון|חיסכון|קרן השתלמות|קופת גמל|גמל|נייר ערך|ניירות ערך|תיק השקעות|השקעה/ },
  { category: 'שכירות', re: /שכירות|שכ"ד|שכ״ד|rent/ },
  { category: 'ביטוח', re: /ביטוח|הרל["״]?צ|הפניקס|מגדל|מנורה מבטחים|איילון|כלל ביטוח|insurance/ },
  { category: 'חשבונות', re: /חשמל|מים|תאגיד|גז |ועד בית|ארנונה|בזק|הוט|hot|פרטנר|סלקום|פלאפון|yes|utility/ },
  { category: 'מנויים', re: /נטפליקס|ספוטיפיי|netflix|spotify|amazon prime|youtube premium|icloud|google one|openai|subscription|מנוי/ },
  { category: 'עמלות בנק', re: /עמלה|עמלות|דמי ניהול|דמי כרטיס|ריבית|bank fee|interest/ },
  { category: 'מזון', re: /סופר|שופרסל|מגה|ויקטורי|רמי לוי|יוחננוף|טיב טעם|אושר עד|יינות ביתן|אמזון|משלוח|food|grocery/ },
  { category: 'רכב', re: /דלק|סונול|פז |דור אלון|תדלוק|חניון|כרטיסיה|טסט|רישיון רכב|צמיג|מוסך|fuel|gas station/ },
  { category: 'אוכל בחוץ', re: /קפה|מסעדה|אוכל|וולט|wolt|תן ביס|שווארמה|פלאפל|בורגר|pizza|restaurant|cafe/ },
  { category: 'ביגוד', re: /ביגוד|נעליים|זארה|zara|h&m|mango|קסטרו|fox|רנואר|fashion/ },
  { category: 'בריאות', re: /בריאות|רפואה|רופא|בית חולים|קופת חולים|מכבי|כללית|מאוחדת|לאומית|סופר פארם|בית מרקחת|health|pharmacy/ },
  { category: 'חינוך', re: /חינוך|לימודים|גננת|מעון|צהרון|בית ספר|אוניברסיט|מכללה|school|education|tuition/ },
  { category: 'העברות', re: /העברה|העברת|זיכוי מחשבון|מסלקה|transfer|bit |ביט |פייבוקס|paybox/ },
]

/** Normalize once so both layers match on the same shape. */
function normalize(description: string): string {
  return (description ?? '').toLowerCase().trim()
}

/**
 * Built-in keyword categorization.
 *
 * Income with no keyword match falls back to `הכנסה אחרת` rather than `אחר`, so an
 * unrecognised deposit is never presented as an unrecognised expense.
 */
export function categorizeByKeywords(description: string, direction?: TxnDirection): string {
  const d = normalize(description)
  if (!d) return direction === 'income' ? 'הכנסה אחרת' : CATEGORY_FALLBACK

  for (const rule of KEYWORD_RULES) {
    if (rule.direction && direction && rule.direction !== direction) continue
    if (rule.re.test(d)) return rule.category
  }

  return direction === 'income' ? 'הכנסה אחרת' : CATEGORY_FALLBACK
}

/** Apply user-learned rules only. Returns null when none match, so callers can fall through. */
export function categorizeByRules(
  description: string,
  rules: readonly CategoryRule[],
  direction?: TxnDirection
): string | null {
  const d = normalize(description)
  if (!d) return null

  for (const rule of rules) {
    if (rule.direction && direction && rule.direction !== direction) continue
    const pattern = normalize(rule.pattern)
    if (pattern && d.includes(pattern)) return rule.category
  }

  return null
}

/** User rules win over built-in keywords — a correction the user made must stick. */
export function categorizeTransaction(
  description: string,
  rules: readonly CategoryRule[] = [],
  direction?: TxnDirection
): string {
  return categorizeByRules(description, rules, direction) ?? categorizeByKeywords(description, direction)
}

/**
 * Pattern proposed when the user categorizes one transaction and asks to apply it to
 * similar ones. Israeli statements append branch codes, dates and installment counters to
 * merchant names, so the leading words carry the identity and the tail is noise.
 */
export function suggestRulePattern(description: string): string {
  const cleaned = normalize(description)
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return normalize(description).slice(0, 24)
  return cleaned.split(' ').slice(0, 3).join(' ')
}
