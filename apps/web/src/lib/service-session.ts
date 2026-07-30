import type { AuthSession } from '@ak-system/api'

/** Server-side session for agents, cron jobs, and other internal callers. */
export function getServiceSession(): NonNullable<AuthSession> {
  return {
    user: {
      id: process.env.SERVICE_USER_ID ?? 'system',
      email: process.env.SERVICE_USER_EMAIL ?? 'system@local',
      name: process.env.SERVICE_USER_NAME ?? 'ARO',
    },
  }
}
