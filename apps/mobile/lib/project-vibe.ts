/** Atmosphere copy shared with the web project glance. Kept local so Metro does not import the web app. */

const POSITIVE = /collaborat|productive|positive|warm|energ|engaged|constructive|friendly|aligned|optimis|חיובי|פורה|שיתופי|חם|אנרגטי|מעורב/i
const NEGATIVE = /tense|tension|frustrat|conflict|negative|cold|disengag|defensive|stress|confus|hostile|מתוח|מתיחות|תסכול|קונפליקט|שלילי|קר|לחוץ|מבולבל/i

export type VibePerson = {
  personId: string
  name: string
  trend: 'warming' | 'cooling' | 'stable' | null
  text: string
}

export type VibeTone = 'warming' | 'cooling' | 'neutral'

function lexicon(text: string | null): number {
  if (!text) return 0
  const pos = POSITIVE.test(text)
  const neg = NEGATIVE.test(text)
  if (pos && !neg) return 1
  if (neg && !pos) return -1
  return 0
}

/** Warmth of one meeting's mood and subtext, on a −1…+1 scale. */
export function moodTone(mood: string | null, subtext: string | null): number {
  return (lexicon(mood) * 2 + lexicon(subtext)) / 3
}

export function moodDotColor(tone: number): string {
  if (tone > 0.15) return '#2dd4bf'
  if (tone < -0.15) return '#fb7185'
  return '#94a3b8'
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} ו${names[1]}`
  return `${names[0]}, ${names[1]} ועוד ${names.length - 2}`
}

export function peopleHeadline(people: VibePerson[]): string {
  const cooling = people.filter((person) => person.trend === 'cooling')
  const warming = people.filter((person) => person.trend === 'warming')
  if (cooling.length === 1) return cooling[0].text
  if (cooling.length > 1) return `${joinNames(cooling.map((person) => person.name))} מתקררים.`
  if (warming.length === 1) return warming[0].text
  if (warming.length > 1) return `${joinNames(warming.map((person) => person.name))} מתחממים.`
  if (people.length === 0) return 'עוד אין אנשים משויכים.'
  return 'אין שינוי בקשרים.'
}

export function peopleTone(people: VibePerson[]): VibeTone {
  if (people.some((person) => person.trend === 'cooling')) return 'cooling'
  if (people.some((person) => person.trend === 'warming')) return 'warming'
  return 'neutral'
}

export function atmosphereTone(text: string): VibeTone {
  if (text.includes('מתקרר')) return 'cooling'
  if (text.includes('מתחממ')) return 'warming'
  return 'neutral'
}

export function scoreTone(text: string): VibeTone {
  if (text.includes('ירד')) return 'cooling'
  if (text.includes('עלה')) return 'warming'
  return 'neutral'
}

export function formatBriefAt(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
