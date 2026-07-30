import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-agents-'))
  process.env.ABC_ROOT = tmpRoot
  fs.mkdirSync(path.join(tmpRoot, 'A_Agents'), { recursive: true })
  fs.mkdirSync(path.join(tmpRoot, 'S_Skills'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpRoot, 'A_Agents', '04_meeting_prep_herald.md'),
    '# Meeting Prep Herald\n\n## Role\n\nPrep meetings.\n',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(tmpRoot, 'S_Skills', 'wf_meeting_prep.md'),
    '# Workflow: Meeting Prep\n\nStage 1\n',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(tmpRoot, 'A_Agents', '01_Hugo_orchestrator.md'),
    '# Hugo\n\n## Role\n\nOrchestrate.\n',
    'utf-8',
  )
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function loadAbc() {
  return import('./abc-agents')
}

describe('abc-agents workflow get/save', () => {
  it('returns the mapped workflow file and content', async () => {
    const { getAgentWorkflowFile, getAgentWorkflowContent } = await loadAbc()
    expect(getAgentWorkflowFile('04_meeting_prep_herald')).toBe('wf_meeting_prep.md')
    expect(getAgentWorkflowContent('04_meeting_prep_herald')).toContain('Workflow: Meeting Prep')
  })

  it('returns null workflow for agents without a mapping', async () => {
    const { getAgentWorkflowFile, getAgentWorkflowContent } = await loadAbc()
    expect(getAgentWorkflowFile('01_Hugo_orchestrator')).toBeNull()
    expect(getAgentWorkflowContent('01_Hugo_orchestrator')).toBeNull()
  })

  it('saves workflow content to S_Skills without touching the agent card', async () => {
    const { saveAgentWorkflowContent, getAgentWorkflowContent, getAgentInstructions } =
      await loadAbc()
    saveAgentWorkflowContent('04_meeting_prep_herald', '# Workflow: Meeting Prep\n\nUpdated stage\n')
    expect(getAgentWorkflowContent('04_meeting_prep_herald')).toContain('Updated stage')
    expect(getAgentInstructions('04_meeting_prep_herald')).toContain('Meeting Prep Herald')
  })

  it('rejects empty workflow content', async () => {
    const { saveAgentWorkflowContent } = await loadAbc()
    expect(() => saveAgentWorkflowContent('04_meeting_prep_herald', '   ')).toThrow(/empty/i)
  })

  it('rejects save when agent has no workflow mapping', async () => {
    const { saveAgentWorkflowContent } = await loadAbc()
    expect(() => saveAgentWorkflowContent('01_Hugo_orchestrator', '# x')).toThrow(/No workflow/i)
  })
})
