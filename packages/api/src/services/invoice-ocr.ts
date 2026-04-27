import { GoogleGenerativeAI } from '@google/generative-ai'
import { VAT_CATEGORIES } from '@ak-system/types'
import { extractTextFromPdf } from './pdf-parser'

export interface InvoiceParseResult {
  amount: number | null
  date: string | null
  invoiceNumber: string | null
  description: string | null
  suggestedCategory: string | null
  isVatExempt: boolean
  vatAmount: number | null
  confidence: 'high' | 'medium' | 'low'
}

const categoryLabels = VAT_CATEGORIES.map((c: { label: string }) => c.label).join(', ')

const PROMPT_IMAGE = `אתה מנתח חשבוניות וקבלות ישראליות. קיבלת תמונה של חשבונית/קבלה.
חלץ את הנתונים הבאים מהמסמך והחזר JSON בלבד (בלי markdown):

{
  "amount": <number — סכום כולל מע"מ, או הסכום הסופי לתשלום>,
  "date": <string — תאריך בפורמט YYYY-MM-DD, או null>,
  "invoiceNumber": <string — מספר חשבונית/קבלה, או null>,
  "description": <string — שם הספק או תיאור קצר של ההוצאה>,
  "suggestedCategory": <string — אחת מהקטגוריות הבאות: ${categoryLabels}>,
  "isVatExempt": <boolean — true אם המסמך פטור ממע"מ (למשל ארנונה, ועד בית, ביטוח לאומי)>,
  "vatAmount": <number — סכום המע"מ אם מצוין במסמך, או null>,
  "confidence": <string — "high" אם הנתונים ברורים, "medium" אם חלקם לא ברורים, "low" אם קשה לקרוא>
}

חוקים:
- החזר JSON טהור בלבד, בלי backticks או markdown
- אם לא ניתן לקרוא שדה, החזר null
- תאריך חייב להיות בפורמט YYYY-MM-DD
- סכום חייב להיות מספר (לא מחרוזת)
- אם יש גם סכום לפני מע"מ וגם אחרי, תעדיף את הסכום כולל מע"מ`

const PROMPT_TEXT = `אתה מנתח טקסט שחולץ מחשבונית או קבלה ישראלית. להלן תוכן המסמך:

---
{{TEXT}}
---

חלץ את הנתונים הבאים והחזר JSON בלבד (בלי markdown):

{
  "amount": <number — סכום כולל מע"מ, או הסכום הסופי לתשלום>,
  "date": <string — תאריך בפורמט YYYY-MM-DD, או null>,
  "invoiceNumber": <string — מספר חשבונית/קבלה, או null>,
  "description": <string — שם הספק או תיאור קצר של ההוצאה>,
  "suggestedCategory": <string — אחת מהקטגוריות הבאות: ${categoryLabels}>,
  "isVatExempt": <boolean — true אם המסמך פטור ממע"מ>,
  "vatAmount": <number — סכום המע"מ אם מצוין, או null>,
  "confidence": <string — "high" | "medium" | "low">
}

החזר JSON בלבד. תאריך ב-YYYY-MM-DD. סכום כמספר.`

function parseGeminiJsonResponse(text: string): InvoiceParseResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      amount: null,
      date: null,
      invoiceNumber: null,
      description: null,
      suggestedCategory: null,
      isVatExempt: false,
      vatAmount: null,
      confidence: 'low',
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      invoiceNumber: parsed.invoiceNumber != null ? String(parsed.invoiceNumber) : null,
      description: typeof parsed.description === 'string' ? parsed.description : null,
      suggestedCategory: typeof parsed.suggestedCategory === 'string' ? parsed.suggestedCategory : null,
      isVatExempt: parsed.isVatExempt === true,
      vatAmount: typeof parsed.vatAmount === 'number' ? parsed.vatAmount : null,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    }
  } catch {
    return {
      amount: null,
      date: null,
      invoiceNumber: null,
      description: null,
      suggestedCategory: null,
      isVatExempt: false,
      vatAmount: null,
      confidence: 'low',
    }
  }
}

export async function parseInvoiceWithVision(
  fileBase64: string,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png',
): Promise<InvoiceParseResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY לא מוגדר. הוסף את המפתח ב-.env')
  }

  const genAI = new GoogleGenerativeAI(key)
  // Use 1.5-flash: same quality, often has separate quota from 2.0 on free tier
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  try {
    let responseText: string

    if (mimeType === 'application/pdf') {
      const buffer = Buffer.from(fileBase64, 'base64')
      const extractedText = await extractTextFromPdf(buffer)
      if (!extractedText || extractedText.trim().length < 10) {
        throw new Error('לא נמצא טקסט ב-PDF. נסה קובץ תמונה (JPEG/PNG) של החשבונית.')
      }
      const prompt = PROMPT_TEXT.replace('{{TEXT}}', extractedText.slice(0, 12000))
      const result = await model.generateContent(prompt)
      responseText = result.response.text().trim()
    } else {
      const result = await model.generateContent([
        { text: PROMPT_IMAGE },
        {
          inlineData: {
            mimeType,
            data: fileBase64,
          },
        },
      ])
      responseText = result.response.text().trim()
    }

    return parseGeminiJsonResponse(responseText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('GEMINI_API_KEY')) throw err
    if (msg.includes('לא נמצא טקסט')) throw err
    if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
      throw new Error('מכסת Gemini (חינם) אזלה. נסה שוב בעוד דקה, או בדוק מכסה ב־Google AI Studio.')
    }
    throw new Error(`שגיאה בניתוח הקובץ: ${msg}`)
  }
}
