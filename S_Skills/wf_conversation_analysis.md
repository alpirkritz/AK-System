# Workflow: Conversation Analysis

**Agent:** `09_conversation_analyst`  
**Purpose:** Extract qualitative insights, mood, subtext, and actionable next steps from meeting transcripts  
**Execution Mode:** Single-shot (completes in one LLM call with JSON schema)

---

## Input

**Required:**
- Raw meeting transcript (plain text dialogue)
- Meeting title
- Meeting date (ISO format)

**Optional:**
- Known participant names (from `meeting_people` join)

---

## Steps

### Stage 1: Hat Selection

**Goal:** Identify the appropriate analytical lens

**Actions:**
1. Read the first 500 words of the transcript
2. Identify keywords and themes:
   - Strategy, transformation, adoption → McKinsey + Tech Innovation
   - Conflict, feelings, team dynamics → Clinical Psychology
   - Features, users, prioritization → Product Management
   - Negotiation, persuasion, deals → Sales & Negotiation
   - Leadership, decisions, career → Executive Coaching
   - Architecture, code, technical → Engineering Deep Dive
   - None of the above → Default (General Business)
3. Select **one** hat from the catalog
4. If uncertain, default to "Default (General Business)"

**Output:** `hatName` field

---

### Stage 2: Core Analysis

**Goal:** Extract observable patterns and hidden dynamics

**Actions:**

#### 2.1 Topic Extraction
- Summarize the conversation's main subject in one sentence
- Be specific: "Feature prioritization for Q2 launch" not "Planning discussion"
- Output: `topic` field

#### 2.2 Mood Assessment
- Identify the overall atmosphere using professional descriptors
- Examples:
  - Positive: "focused and collaborative", "energized brainstorming", "calm and methodical"
  - Neutral: "structured and procedural", "information-sharing"
  - Challenging: "tense with urgency", "frustrated but constructive", "exploratory with uncertainty"
- Avoid: judgmental terms ("bad meeting"), vague terms ("okay")
- Output: `mood` field

#### 2.3 Subtext Analysis
- Identify unspoken dynamics beneath the surface conversation:
  - Power dynamics (who defers to whom, who drives decisions)
  - Hidden assumptions (unquestioned beliefs shaping the discussion)
  - Implicit conflicts (disagreements not directly addressed)
  - Emotional currents (anxiety, excitement, defensiveness)
  - Missing voices (perspectives not represented)
- Be specific and evidence-based: cite patterns observed in the transcript
- Output: `subtext` field

#### 2.4 Key Insight
- What is the **most important** takeaway from this conversation?
- Should be:
  - Non-obvious (not just a summary of decisions)
  - Actionable or reflective
  - Memorable
- Examples:
  - Good: "The team is conflating technical debt with feature velocity—treating symptoms not root cause"
  - Bad: "The team discussed technical issues" ❌
- Output: `keyInsight` field

---

### Stage 3: Scoring

**Goal:** Evaluate conversation quality on a 1-10 scale

**Criteria:**
- **Clarity** — Were goals and decisions explicit?
- **Productivity** — Did the conversation advance understanding or decisions?
- **Engagement** — Were all voices heard, or did one person dominate?
- **Follow-through** — Were action items clearly assigned?
- **Alignment** — Did participants leave with shared understanding?

**Scoring Guide:**
- **9-10:** Exceptional—clear decisions, balanced participation, actionable outcomes
- **7-8:** Strong—productive with minor gaps (e.g., one unresolved question)
- **5-6:** Adequate—made progress but lacked structure or follow-through
- **3-4:** Weak—unclear outcomes, unbalanced participation, or unresolved tensions
- **1-2:** Poor—unproductive, chaotic, or toxic dynamics

**Actions:**
1. Assign a score (integer 1-10)
2. Write 1-2 sentence rationale citing specific patterns
3. Output: `score` and `scoreRationale` fields

---

### Stage 4: Kaizen Feedback

**Goal:** Provide constructive feedback in kaizen format (keep/improve)

**Actions:**

#### 4.1 Keep (לשימור)
- Identify 1-2 specific practices that worked well
- Be concrete: "The structured agenda" not "Good planning"
- Examples:
  - "Using the shared screen to review the doc kept everyone aligned"
  - "Starting with a quick round-robin check-in surfaced concerns early"
- Output: `kaizenKeep` field

#### 4.2 Improve (לשיפור)
- Identify 1-2 actionable improvements for next time
- Be constructive and specific
- Focus on process, not people
- Examples:
  - "Schedule 10 min buffer after for documentation—decisions were verbal only"
  - "Invite the QA lead next time—testing concerns were raised but no expert present"
- Avoid:
  - Vague: "Communicate better" ❌
  - Judgmental: "X should stop interrupting" ❌
- Output: `kaizenImprove` field

---

### Stage 5: Participants

**Goal:** List all speakers identified in the transcript

**Actions:**
1. Extract unique speaker names/identifiers
2. For each, determine confidence:
   - `confirmed: true` — Name is explicitly stated ("As Sarah mentioned...")
   - `confirmed: false` — Name is inferred from context or ambiguous
3. If transcript has no clear speaker labels, list as "Speaker 1", "Speaker 2", etc., all unconfirmed
4. Output: `participants` array

**Example:**
```json
[
  { "name": "איציק", "confirmed": true },
  { "name": "מירי", "confirmed": true },
  { "name": "Unknown 1", "confirmed": false }
]
```

---

### Stage 6: Action Items

**Goal:** Extract explicit commitments and next steps

**Actions:**

#### 6.1 Identify Action Items
- Look for phrases indicating commitment:
  - Hebrew: "אני אטפל", "נבדוק", "תשלח", "נתאם"
  - English: "I'll...", "We'll...", "X will...", "Let's..."
- Each item should be a concrete, actionable task
- Exclude:
  - Vague intentions: "We should think about..." ❌
  - Decisions without action: "We decided to go with option A" (unless implementation is specified)

#### 6.2 Identify Owners
- If a specific person is named or implied, include in `owner` field
- Match against known participant names
- If owner is ambiguous or unstated, leave `owner` null

**Output:** `actionItems` array

**Example:**
```json
[
  {
    "content": "Build pain points map based on 1:1s with dev managers",
    "owner": "מירי"
  },
  {
    "content": "Organize open roundtables without direct managers present",
    "owner": "מירי"
  },
  {
    "content": "Check ADP system invite status for managers",
    "owner": null
  }
]
```

---

### Stage 7: Open Question

**Goal:** Formulate one thought-provoking question for user reflection

**Characteristics:**
- **Open-ended** — No yes/no answer
- **Strategic** — Challenges assumptions or expands perspective
- **Relevant** — Directly connected to conversation themes
- **Actionable** — User can actually reflect on or investigate it

**Examples:**
- Good: "How can we measure and reward developer value in an era where AI writes the code, to restore their sense of security?"
- Bad: "Was this a good meeting?" ❌ (yes/no, too generic)
- Bad: "What should we do next?" ❌ (too vague)

**Output:** `openQuestion` field

---

## Output Schema

Return JSON matching this TypeScript interface:

```typescript
{
  hatName: string
  topic: string
  mood: string
  subtext: string
  keyInsight: string
  score: number            // 1-10
  scoreRationale: string
  kaizenKeep: string
  kaizenImprove: string
  openQuestion: string
  participants: Array<{ name: string; confirmed: boolean }>
  actionItems: Array<{ content: string; owner?: string }>
}
```

---

## Error Handling

**If transcript is too short (<100 words):**
- Return error: "Transcript too short for meaningful analysis (minimum 100 words)"

**If transcript is incoherent or corrupted:**
- Return error: "Transcript appears corrupted or non-linguistic"

**If no action items found:**
- Return empty `actionItems` array (not an error)

**If unable to determine mood/subtext:**
- Use neutral defaults:
  - `mood: "informational discussion"`
  - `subtext: "Surface-level conversation without evident deeper dynamics"`

---

## Quality Checks

Before returning analysis, verify:

- [ ] Hat selection is appropriate for transcript content
- [ ] Subtext is specific and evidence-based (not generic)
- [ ] Score rationale cites concrete patterns from conversation
- [ ] Kaizen feedback is actionable and constructive
- [ ] Action items are discrete tasks, not vague intentions
- [ ] Open question is strategic and thought-provoking
- [ ] All required fields are present and non-empty (except `owner` in action items)

---

## Language Matching

**If transcript is primarily Hebrew:**
- All analysis fields should be in Hebrew
- Exception: `hatName` uses English catalog names

**If transcript is primarily English:**
- All analysis fields in English

**If transcript is mixed:**
- Use primary language (>60% of words)

---

## Performance Notes

- Target completion time: 10-15 seconds for typical 1-hour meeting transcript
- Gemini 2.5 Flash is sufficient for this task (no need for Pro)
- Use JSON schema mode to ensure valid output structure
- Cap transcript at 50,000 characters before analysis
