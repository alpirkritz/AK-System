import { GoogleGenerativeAI } from '@google/generative-ai'
import { VAT_CATEGORIES } from '@ak-system/types'

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

const PROMPT = `אתה מנתח חשבוניות וקבלות ישראליות. קיבלת תמונה או PDF של חשבונית/קבלה.
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

export async function parseInvoiceWithVision(
  fileBase64: string,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png',
): Promise<InvoiceParseResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent([
    { text: PROMPT },
    {
      inlineData: {
        mimeType,
        data: fileBase64,
      },
    },
  ])

  const text = result.response.text().trim()

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
