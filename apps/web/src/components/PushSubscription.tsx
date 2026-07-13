'use client'

import { useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc'
import {
  getOrCreatePushSubscription,
  installForegroundPushListener,
} from '@/lib/push-client'

export function PushSubscription() {
  const subscribed = useRef(false)
  const { data: vapidKey } = trpc.push.getVapidPublicKey.useQuery()
  const subscribe = trpc.push.subscribe.useMutation()

  useEffect(() => {
    installForegroundPushListener()
  }, [])

  useEffect(() => {
    if (!vapidKey || subscribed.current) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'denied') return

    async function registerPush() {
      try {
        const sub = await getOrCreatePushSubscription(vapidKey!)
        const json = sub.toJSON()
        if (json.endpoint && json.keys) {
          subscribe.mutate({
            endpoint: json.endpoint,
            keys: {
              p256dh: json.keys.p256dh!,
              auth: json.keys.auth!,
            },
          })
        }
        subscribed.current = true
      } catch {
        // Optional auto-register on load — user can enable manually in Settings.
      }
    }

    registerPush()
  }, [vapidKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
