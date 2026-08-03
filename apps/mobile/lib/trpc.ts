import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import { API_URL, CLIENT_HEADER } from './api'

/**
 * Bearer-authed tRPC client for Helm. The web tRPC route handler accepts
 * `Authorization: Bearer <jwt>`, so the native app can reuse every existing
 * procedure without new REST endpoints. We type the client loosely (the full
 * AppRouter type lives in a server-only package) and wrap calls in typed
 * helpers in `lib/data.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTrpcClient(token: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createTRPCProxyClient<any>({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        headers() {
          return {
            Authorization: `Bearer ${token}`,
            'X-AK-Client': CLIENT_HEADER,
            // See lib/api.ts — bypasses ngrok's free-plan HTML interstitial.
            'ngrok-skip-browser-warning': 'true',
          }
        },
      }),
    ],
  })
}
