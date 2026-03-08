// So Next.js type-check finds the module in pnpm/Docker build (package is in apps/web deps)
declare module 'googleapis' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const google: any
  export type calendar_v3 = any
}
