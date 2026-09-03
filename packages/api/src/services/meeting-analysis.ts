/**
 * Meeting transcript analysis service using Gemini with JSON schema.
 * Extracts mood, subtext, kaizen feedback, and action items from conversations.
 */

import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'

function geminiModelId(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

function geminiGenerationConfig(): GenerationConfig {
  const model = geminiModelId()
  if (model.startsWith('gemini-3')) {
    const level = (process.env.GEMINI_THINKING_LEVEL || 'high').toLowerCase()
    return { thinkingConfig: { thinkingLevel: level } } as GenerationConfig
  }
  if (model.includes('2.5')) {
    const raw = process.env.GEMINI_THINKING_BUDGET?.trim()
    const budget = raw !== undefined && raw !== '' ? Number(raw) : -1
    return { thinkingConfig: { thinkingBudget: Number.isFinite(budget) ? budget : -1 } } as GenerationConfig
  }
  return {}
}

export interface AnalyzeTranscriptOptions {
  transcriptText: string
  meetingTitle: string
  meetingDate: string
  participantNames?: string[]
}

export interface AnalysisParticipant {
  name: string
  confirmed: boolean
}

export interface AnalysisActionItem {
  content: string
  owner?: string
}

export interface AnalysisResult {
  hatName: string
  topic: string
  mood: string
  subtext: string
  keyInsight: string
  score: number
  scoreRationale: string
  kaizenKeep: string
  kaizenImprove: string
  openQuestion: string
  participants: AnalysisParticipant[]
  actionItems: AnalysisActionItem[]
}

const GEMINI_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    hatName: {
      type: 'string' as const,
      description: 'Selected analytical hat from the catalog',
    },
    topic: {
      type: 'string' as const,
      description: 'One-sentence summary of conversation focus',
    },
    mood: {
      type: 'string' as const,
      description: 'Professional descriptor of conversation atmosphere',
    },
    subtext: {
      type: 'string' as const,
      description: 'Hidden dynamics not explicitly stated',
    },
    keyInsight: {
      type: 'string' as const,
      description: 'Most important takeaway from the conversation',
    },
    score: {
      type: 'integer' as const,
      description: 'Quality rating from 1-10',
    },
    scoreRationale: {
      type: 'string' as const,
      description: 'Reasoning for the score',
    },
    kaizenKeep: {
      type: 'string' as const,
      description: 'What worked well that should be preserved',
    },
    kaizenImprove: {
      type: 'string' as const,
      description: 'What could be enhanced next time',
    },
    openQuestion: {
      type: 'string' as const,
      description: 'Thought-provoking question for reflection',
    },
    participants: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          confirmed: { type: 'boolean' as const },
        },
        required: ['name', 'confirmed'],
      },
    },
    actionItems: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          content: { type: 'string' as const },
          owner: { type: 'string' as const },
        },
        required: ['content'],
      },
    },
  },
  required: [
    'hatName',
    'topic',
    'mood',
    'subtext',
    'keyInsight',
    'score',
    'scoreRationale',
    'kaizenKeep',
    'kaizenImprove',
    'openQuestion',
    'participants',
    'actionItems',
  ],
}

function buildAnalysisPrompt(options: AnalyzeTranscriptOptions): string {
  const { transcriptText, meetingTitle, meetingDate, participantNames } = options

  const participantsNote = participantNames?.length
    ? `\n\nKnown participants from the meeting record: ${participantNames.join(', ')}`
    : ''

  return `You are a conversation analyst. Analyze the following meeting transcript and provide deep qualitative insights.

Meeting: ${meetingTitle}
Date: ${meetingDate}${participantsNote}

ANALYTICAL HATS CATALOG:
1. McKinsey + Tech Innovation — Strategy, digital transformation, organizational change
2. Clinical Psychology — Interpersonal dynamics, conflict resolution, emotional intelligence
3. Product Management — User needs, prioritization, trade-offs, roadmap decisions
4. Sales & Negotiation — Persuasion tactics, objection handling, deal structure
5. Executive Coaching — Leadership presence, decision quality, stakeholder management
6. Engineering Deep Dive — Technical accuracy, design patterns, architectural trade-offs
7. Default (General Business) — General business discussion, no specialized lens applies

INSTRUCTIONS:

1. HAT SELECTION: Read the first 500 words and select the most appropriate analytical hat from the catalog above.

2. CORE ANALYSIS:
   - topic: One-sentence summary of the conversation's main subject
   - mood: Professional descriptor of the atmosphere (e.g., "focused and collaborative", "tense with urgency")
   - subtext: Hidden dynamics beneath the surface (power dynamics, implicit conflicts, unspoken assumptions)
   - keyInsight: The most important non-obvious takeaway

3. SCORING: Rate the conversation quality 1-10 based on clarity, productivity, engagement, follow-through, and alignment. Provide a 1-2 sentence rationale.

4. KAIZEN FEEDBACK:
   - kaizenKeep: 1-2 specific practices that worked well
   - kaizenImprove: 1-2 actionable improvements for next time

5. PARTICIPANTS: List all speakers identified in the transcript. Mark confirmed: true if name is explicitly stated, false if inferred.

6. ACTION ITEMS: Extract explicit commitments and next steps. Include owner name if mentioned in transcript.

7. OPEN QUESTION: Formulate one strategic, open-ended question for the user to reflect on.

QUALITY STANDARDS:
- Be specific and evidence-based (not vague or generic)
- Keep feedback constructive and actionable
- Match the transcript's primary language (Hebrew or English)
- Do not invent information not present in the transcript

---

TRANSCRIPT:

${transcriptText}

---

Analyze the conversation and return your analysis in the specified JSON format.`
}

export async function analyzeTranscript(options: AnalyzeTranscriptOptions): Promise<AnalysisResult> {
  const { transcriptText } = options

  // Validation
  if (!transcriptText || transcriptText.trim().length < 100) {
    throw new Error('Transcript too short for meaningful analysis (minimum 100 words)')
  }

  // Initialize Gemini
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const modelId = geminiModelId()
  
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_JSON_SCHEMA,
      ...geminiGenerationConfig(),
    },
  })

  const prompt = buildAnalysisPrompt(options)

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()

    if (!text) {
      throw new Error('Empty response from Gemini')
    }

    const analysis = JSON.parse(text) as AnalysisResult

    // Validate required fields
    if (!analysis.hatName || !analysis.topic || !analysis.mood) {
      throw new Error('Incomplete analysis response from Gemini')
    }

    // Ensure score is within bounds
    if (analysis.score < 1 || analysis.score > 10) {
      analysis.score = Math.max(1, Math.min(10, analysis.score))
    }

    return analysis
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Analysis failed: ${error.message}`)
    }
    throw new Error('Analysis failed with unknown error')
  }
}

/**
 * Derives task priority from action item content based on urgency keywords.
 * Used to pre-fill task creation forms with intelligent priority defaults.
 */
export function derivePriorityFromContext(content: string): 'high' | 'medium' | 'low' {
  const lower = content.toLowerCase()
  const urgentKeywords = [
    'דחוף',
    'urgent',
    'asap',
    'היום',
    'עכשיו',
    'מיידי',
    'critical',
    'today',
    'now',
    'immediately',
  ]
  return urgentKeywords.some((kw) => lower.includes(kw)) ? 'high' : 'medium'
}
