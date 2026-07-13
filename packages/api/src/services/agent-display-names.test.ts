import { describe, expect, it } from 'vitest'
import { applyDisplayName, buildCustomAgentAliases } from './agent-display-names'

describe('agent-display-names', () => {
  it('applyDisplayName uses custom name when set', () => {
    const agent = { id: '06_calendar_optimizer', name: 'Calendar Optimizer', role: 'x' }
    const result = applyDisplayName(agent, { '06_calendar_optimizer': 'טמפו' })
    expect(result.name).toBe('טמפו')
    expect(result.defaultName).toBe('Calendar Optimizer')
  })

  it('applyDisplayName falls back to markdown name', () => {
    const agent = { id: '06_calendar_optimizer', name: 'Calendar Optimizer', role: 'x' }
    const result = applyDisplayName(agent, {})
    expect(result.name).toBe('Calendar Optimizer')
  })

  it('buildCustomAgentAliases maps multiple segments', () => {
    const aliases = buildCustomAgentAliases({ '06_calendar_optimizer': 'טמפו | tempo' })
    expect(aliases['טמפו']).toBe('06_calendar_optimizer')
    expect(aliases['tempo']).toBe('06_calendar_optimizer')
  })
})
