import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Multimodal analyze endpoint (Second Brain spec).
 * POST /api/analyze with multipart: optional "file" (image), optional "text".
 * Returns Gemini analysis (summary, insights) as JSON.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 503 })
  }

  try {
    const formData = await request.formData()
    const textPart = (formData.get('text') as string | null)?.trim() || ''
    const file = formData.get('file') as File | null

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    if (textPart) parts.push({ text: textPart })

    if (file && file.size > 0) {
      const mime = file.type || 'image/jpeg'
      if (!mime.startsWith('image/')) {
        return NextResponse.json({ error: 'Only image files are supported for now' }, { status: 400 })
      }
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      parts.push({ inlineData: { mimeType: mime, data: base64 } })
    }

    if (parts.length === 0) {
      return NextResponse.json({ error: 'Provide at least "text" or "file" in the request' }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: 'You are a helpful assistant. Analyze the user input (text and/or image) and respond with a concise summary and key insights. Respond in the same language as the user input.',
    })
    const result = await model.generateContent({ contents: [{ role: 'user', parts }] })
    const response = result.response
    const analysis = response.text()

    return NextResponse.json({ analysis, ok: true })
  } catch (err) {
    console.error('[api/analyze]', err)
    const msg = err instanceof Error ? err.message : 'Analysis failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
