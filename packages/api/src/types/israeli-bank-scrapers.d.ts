/**
 * Minimal ambient typing for the surface of israeli-bank-scrapers we use.
 * We intentionally do not rely on the package's own types so that:
 *  1. TypeScript checks pass in environments where the heavy dependency
 *     (puppeteer + chromium) is not installed (CI sandboxes, tests).
 *  2. The Next.js build never pulls puppeteer types into its graph.
 * The runtime package must still be installed (packages/api dependency).
 */
declare module 'israeli-bank-scrapers' {
  export enum CompanyTypes {
    hapoalim = 'hapoalim',
    otsarHahayal = 'otsarHahayal',
    visaCal = 'visaCal',
    isracard = 'isracard',
    leumi = 'leumi',
    discount = 'discount',
    mercantile = 'mercantile',
    mizrahi = 'mizrahi',
    beinleumi = 'beinleumi',
    massad = 'massad',
    yahav = 'yahav',
    union = 'union',
    max = 'max',
    amex = 'amex',
    behatsdaa = 'behatsdaa',
    beyahadBishvilha = 'beyahadBishvilha',
    oneZero = 'oneZero',
  }

  export interface ScraperOptions {
    companyId: CompanyTypes
    startDate: Date
    combineInstallments?: boolean
    showBrowser?: boolean
    verbose?: boolean
    timeout?: number
    executablePath?: string
    args?: string[]
  }

  export interface Scraper {
    scrape(credentials: Record<string, string>): Promise<{
      success: boolean
      accounts?: Array<{
        accountNumber: string
        balance?: number
        txns: Array<{
          type: string
          identifier?: number | string
          date: string
          processedDate: string
          originalAmount: number
          originalCurrency: string
          chargedAmount: number
          description: string
          memo?: string | null
          installments?: { number: number; total: number }
          status: string
        }>
      }>
      errorType?: string
      errorMessage?: string
    }>
  }

  export function createScraper(options: ScraperOptions): Scraper
  export const SCRAPERS: Record<string, { name: string; loginFields: string[] }>
}
