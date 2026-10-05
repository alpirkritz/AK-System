import { describe, expect, it } from 'vitest'
import { moodDotColor, moodTone, peopleHeadline } from './project-vibe'

describe('project vibe', () => {
  it('colors a warm meeting teal and a cold one coral', () => {
    expect(moodDotColor(moodTone('warm and engaged', null))).toBe('#2dd4bf')
    expect(moodDotColor(moodTone('tense and cold', null))).toBe('#fb7185')
    expect(moodDotColor(moodTone('unclear', null))).toBe('#94a3b8')
  })

  it('headlines the cooling person, then a warming one, then an empty roster', () => {
    expect(peopleHeadline([
      { personId: 'a', name: 'דנה', trend: 'cooling', text: 'דנה מתקררת.' },
      { personId: 'b', name: 'יוסי', trend: 'warming', text: 'יוסי מתחמם.' },
    ])).toBe('דנה מתקררת.')
    expect(peopleHeadline([
      { personId: 'b', name: 'יוסי', trend: 'warming', text: 'יוסי מתחמם.' },
    ])).toBe('יוסי מתחמם.')
    expect(peopleHeadline([])).toBe('עוד אין אנשים משויכים.')
  })
})
