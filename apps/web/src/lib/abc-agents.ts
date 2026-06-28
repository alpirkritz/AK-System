import fs from 'fs'
import path from 'path'

export interface AgentSummary {
  id: string
  name: string
  role: string
}

function getAbcRoot(): string {
  const configured = process.env.ABC_ROOT
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), '../..')
}

function agentsDir(): string {
  return path.join(getAbcRoot(), 'A_Agents')
}

export function listAgents(): AgentSummary[] {
  const dir = agentsDir()
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((filename) => {
      const id = filename.replace(/\.md$/, '')
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8')
      const nameMatch = content.match(/^#\s+(.+)$/m)
      const name = nameMatch?.[1]?.trim() ?? id
      const roleMatch = content.match(/\*\*Responsibilities:\*\*\s*\n- (.+)/)
        ?? content.match(/## Role\s*\n\s*\n(.+)/)
      const role = roleMatch?.[1]?.trim().slice(0, 120) ?? ''
      return { id, name, role }
    })
}

export function getAgentInstructions(agentId: string): string {
  const safeId = path.basename(agentId)
  const filePath = path.join(agentsDir(), `${safeId}.md`)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent not found: ${agentId}`)
  }
  return fs.readFileSync(filePath, 'utf-8')
}

export function getAbcRootPath(): string {
  return getAbcRoot()
}

export function agentNeedsNotionContext(agentId: string): boolean {
  return agentId.includes('morning_briefing') || agentId.includes('morning-briefing')
}
