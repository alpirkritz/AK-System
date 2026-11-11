import { describe, expect, it, beforeEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ak-bridge-config-'))
const authStatePath = join(root, 'auth')
const configPath = join(root, 'config')

process.env.BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'test'
process.env.AUTH_STATE_PATH = authStatePath
process.env.BRIDGE_CONFIG_PATH = configPath

const PN = '972501234567@s.whatsapp.net'
const GROUP = '120363012345678901@g.us'
const isSelf = (jid: string) => jid.startsWith('972500000000')

function groupRule(jid: string) {
  return {
    jid,
    name: jid,
    enabled: true,
    fomoEnabled: false,
    fomoThreshold: 5,
    fomoWindowMinutes: 5,
    keywords: [],
    summaryTimes: [],
    labelSummaryTimes: [],
    lastFomoAlertAt: null,
  }
}

/** Each call is a fresh module graph — the bridge's state is all module-level. */
async function restartBridgeModules() {
  vi.resetModules()
  return {
    config: (await import('./config.js')).config,
    dm: await import('./dm-capture.js'),
    groups: await import('./group-config.js'),
  }
}

describe('bridge config location', () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true })
    mkdirSync(authStatePath, { recursive: true })
  })

  it('keeps the config path outside the auth-state directory', async () => {
    const { config } = await restartBridgeModules()
    expect(config.configPath).toBe(configPath)
    expect(config.configPath.startsWith(`${config.authStatePath}/`)).toBe(false)
  })

  it('writes the capture lists to the config path, not the auth path', async () => {
    const { dm, groups } = await restartBridgeModules()
    dm.reloadDmConfig([PN])
    groups.reloadGroupConfig([groupRule(GROUP)])
    expect(existsSync(join(configPath, 'dm-config.json'))).toBe(true)
    expect(existsSync(join(configPath, 'group-config.json'))).toBe(true)
    expect(existsSync(join(authStatePath, 'dm-config.json'))).toBe(false)
    expect(existsSync(join(authStatePath, 'group-config.json'))).toBe(false)
  })

  it('survives a session reset that clears the auth-state directory', async () => {
    const before = await restartBridgeModules()
    before.dm.reloadDmConfig([PN])
    before.groups.reloadGroupConfig([groupRule(GROUP)])

    rmSync(authStatePath, { recursive: true, force: true })
    mkdirSync(authStatePath, { recursive: true })

    const after = await restartBridgeModules()
    after.dm.loadPersistedDmConfig()
    after.groups.loadPersistedGroupConfig()
    expect(after.dm.dmAllowlistSize()).toBe(1)
    expect(after.dm.resolveCapturedDm(PN, [], isSelf)).toEqual({ jid: PN, altJid: null })
    expect(after.groups.isGroupWatched(GROUP)).toBe(true)
  })

  it('migrates config left behind in the auth-state directory by an older install', async () => {
    writeFileSync(join(authStatePath, 'dm-config.json'), JSON.stringify([PN]), 'utf8')
    writeFileSync(join(authStatePath, 'group-config.json'), JSON.stringify([groupRule(GROUP)]), 'utf8')

    const { dm, groups } = await restartBridgeModules()
    dm.loadPersistedDmConfig()
    groups.loadPersistedGroupConfig()
    expect(dm.dmAllowlistSize()).toBe(1)
    expect(groups.isGroupWatched(GROUP)).toBe(true)
    expect(existsSync(join(configPath, 'dm-config.json'))).toBe(true)
    expect(existsSync(join(configPath, 'group-config.json'))).toBe(true)
  })

  it('prefers the config path when the file exists in both places', async () => {
    writeFileSync(join(authStatePath, 'dm-config.json'), JSON.stringify([PN]), 'utf8')
    mkdirSync(configPath, { recursive: true })
    writeFileSync(join(configPath, 'dm-config.json'), JSON.stringify([PN, '972509999999@s.whatsapp.net']), 'utf8')

    const { dm } = await restartBridgeModules()
    dm.loadPersistedDmConfig()
    expect(dm.dmAllowlistSize()).toBe(2)
  })
})
