import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import { config } from './config.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export function configFilePath(name: string): string {
  return join(config.configPath, name)
}

/**
 * Path to read a config file from. Installations paired before the config/auth split still
 * have the file inside `authStatePath`; it is copied out once, on the first read.
 */
export function resolveConfigFileForRead(name: string): string {
  const target = configFilePath(name)
  if (existsSync(target)) return target
  const legacy = join(config.authStatePath, name)
  if (!existsSync(legacy)) return target
  try {
    mkdirSync(config.configPath, { recursive: true })
    copyFileSync(legacy, target)
    logger.warn({ name }, 'Migrated bridge config out of the auth-state directory')
    return target
  } catch (err) {
    logger.error({ err, name }, 'Failed to migrate bridge config — reading it from the auth-state path')
    return legacy
  }
}
