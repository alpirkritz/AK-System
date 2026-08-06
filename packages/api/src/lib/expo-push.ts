/**
 * @deprecated Expo Push gateway removed — use sendMobilePush from ./mobile-push.
 * Kept as a thin alias so any stray imports still compile during the migration window.
 */
export { sendMobilePush as sendExpoPush } from './mobile-push'

/** @deprecated Direct FCM logs immediately; delayed Expo receipt polling is a no-op. */
export async function checkPendingExpoReceipts(): Promise<{
  checked: number
  failed: number
}> {
  return { checked: 0, failed: 0 }
}
