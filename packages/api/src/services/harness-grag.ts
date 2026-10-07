/**
 * Optional grag mirror for the harness world model.
 *
 * The authoritative store is the app database — production runs in Docker on EC2 where
 * the grag binary does not exist. On a developer machine that has it, mirroring the
 * freshly indexed summaries makes the world model searchable from the grag MCP tools too.
 *
 * Every failure here is swallowed: a missing binary must never fail an index run.
 */
import { spawn } from 'node:child_process'

const GRAG_TIMEOUT_MS = 10_000

export function isGragMirrorEnabled(): boolean {
  return Boolean(process.env.GRAG_DB_PATH && process.env.HARNESS_GRAG_MIRROR !== '0')
}

function gragBinary(): string {
  return process.env.GRAG_BIN || 'grag'
}

/** Writes one memory per line. Resolves to the number of lines actually mirrored. */
export async function mirrorToGrag(lines: string[]): Promise<number> {
  if (!isGragMirrorEnabled() || lines.length === 0) return 0

  const body = lines.join('\n')
  try {
    await runGrag(['--db', process.env.GRAG_DB_PATH as string, 'remember', body])
    return lines.length
  } catch (err) {
    console.warn('[harness-grag] mirror skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}

function runGrag(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(gragBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('grag timed out'))
    }, GRAG_TIMEOUT_MS)

    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `grag exited with ${code}`))
    })
  })
}
