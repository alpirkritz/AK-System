import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import {
  pushSubscriptions,
  expoPushTokens,
  fcmPushTokens,
  pushDeliveryLog,
  eq,
  desc,
  queryRows,
} from '@ak-system/database'
import { sendMobilePush } from '../lib/mobile-push'
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

      let fcmSent = 0
      try {
        fcmSent = await sendMobilePush(input.title, input.body, input.url ?? '/chat')
      } catch (err) {
        console.warn('[push.sendToAll] FCM push failed:', err)
      }

      return {
        sent: subs.length - failed.length,
        removed: failed.length,
        webSent: subs.length - failed.length,
        fcmSent,
      }
    }),

  registerFcmToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        platform: z.literal('android'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString()
      const existing = await ctx.db
        .select()
        .from(fcmPushTokens)
        .where(eq(fcmPushTokens.token, input.token))
        .get()

      if (existing) {
        await ctx.db
          .update(fcmPushTokens)
          .set({ updatedAt: now, platform: input.platform })
          .where(eq(fcmPushTokens.id, existing.id))
          .run()
        return { id: existing.id }
      }

      const id = crypto.randomUUID()
      await ctx.db
        .insert(fcmPushTokens)
        .values({
          id,
          token: input.token,
          platform: input.platform,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      return { id }
    }),

  unregisterFcmToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(fcmPushTokens).where(eq(fcmPushTokens.token, input.token)).run()
      return { ok: true as const }
    }),

  /** @deprecated Prefer registerFcmToken — kept for one release. */
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

  /** @deprecated Prefer unregisterFcmToken — kept for one release. */
  unregisterExpoToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(expoPushTokens).where(eq(expoPushTokens.token, input.token)).run()
      return { ok: true as const }
    }),

  /** Last push delivery results — for debugging "sent but never arrived". */
  deliveryLog: protectedProcedure.query(async ({ ctx }) => {
    const rows = await queryRows<{
      id: string
      ticketId: string | null
      provider: string | null
      providerMessageId: string | null
      token: string
      status: string
      errorCode: string | null
      message: string | null
      sentAt: string
      checkedAt: string | null
    }>(ctx.db.select().from(pushDeliveryLog).orderBy(desc(pushDeliveryLog.sentAt)).limit(50))
    return rows.map((r) => ({
      ...r,
      provider: r.provider ?? 'expo',
      token: `…${r.token.slice(-12)}`,
    }))
  }),
})
