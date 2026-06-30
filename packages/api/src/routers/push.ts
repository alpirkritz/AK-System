import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import { pushSubscriptions, expoPushTokens, eq } from '@ak-system/database'
import { sendExpoPush } from '../lib/expo-push'
import { createNotification } from '../lib/notification-store'
import webPush from 'web-push'

const vapidPublic = process.env.VAPID_PUBLIC_KEY ?? ''
const vapidPrivate = process.env.VAPID_PRIVATE_KEY ?? ''
const vapidEmail = process.env.VAPID_EMAIL ?? 'mailto:admin@example.com'

if (vapidPublic && vapidPrivate) {
  webPush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate)
}

export const pushRouter = router({
  getVapidPublicKey: protectedProcedure.query(() => vapidPublic),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string(),
          auth: z.string(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID()
      const existing = await ctx.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .get()

      if (existing) {
        await ctx.db
          .update(pushSubscriptions)
          .set({ p256dh: input.keys.p256dh, auth: input.keys.auth })
          .where(eq(pushSubscriptions.id, existing.id))
          .run()
        return { id: existing.id }
      }

      await ctx.db.insert(pushSubscriptions).values({
        id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        createdAt: new Date().toISOString(),
      }).run()
      return { id }
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .run()
      return { ok: true }
    }),

  sendToAll: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        body: z.string(),
        url: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!vapidPublic || !vapidPrivate) {
        throw new Error('VAPID keys not configured')
      }

      try {
        await createNotification({
          title: input.title,
          body: input.body,
          url: input.url ?? '/chat',
          type: 'system',
        })
      } catch (err) {
        console.warn('[push.sendToAll] createNotification failed:', err)
      }

      const subs = await ctx.db.select().from(pushSubscriptions).all()
      const payload = JSON.stringify({
        title: input.title,
        body: input.body,
        url: input.url ?? '/',
        icon: '/icons/icon-192.png',
      })

      const results = await Promise.allSettled(
        subs.map((sub) =>
          webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          ),
        ),
      )

      const failed = results
        .map((r, i) => (r.status === 'rejected' ? i : null))
        .filter((i): i is number => i !== null)

      for (const i of failed) {
        await ctx.db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subs[i].endpoint))
          .run()
      }

      let expoSent = 0
      try {
        expoSent = await sendExpoPush(input.title, input.body, input.url ?? '/chat')
      } catch (err) {
        console.warn('[push.sendToAll] Expo push failed:', err)
      }

      return {
        sent: subs.length - failed.length,
        removed: failed.length,
        webSent: subs.length - failed.length,
        expoSent,
      }
    }),

  registerExpoToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(expoPushTokens)
        .where(eq(expoPushTokens.token, input.token))
        .get()

      if (existing) return { id: existing.id }

      const id = crypto.randomUUID()
      await ctx.db
        .insert(expoPushTokens)
        .values({
          id,
          token: input.token,
          createdAt: new Date().toISOString(),
        })
        .run()
      return { id }
    }),

  unregisterExpoToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(expoPushTokens).where(eq(expoPushTokens.token, input.token)).run()
      return { ok: true as const }
    }),
})
