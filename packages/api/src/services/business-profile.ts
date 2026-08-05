import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'
import type { SalesDocumentType, DocumentLanguage } from '@ak-system/types'

const SETTINGS_ID = 'default'

export type BusinessProfile = {
  businessName: string
  businessNameEn?: string
  ownerName?: string
  taxId?: string
  taxIdType?: 'osek_morshe' | 'osek_patur' | 'company'
  address?: string
  addressEn?: string
  city?: string
  zipCode?: string
  phone?: string
  email?: string
  website?: string
  /** Overrides the bundled /brand/alpir-logo.png without a redeploy. */
  logoDataUrl?: string
  bankDetails?: string
  bankDetailsEn?: string
  footerText?: string
  footerTextEn?: string
  defaultPaymentTerms?: string
  defaultLanguage?: DocumentLanguage
  numberPrefix?: string
  /** Continue numbering from the previous system instead of restarting at 1. */
  startNumbers?: Partial<Record<SalesDocumentType, number>>
}

export const EMPTY_BUSINESS_PROFILE: BusinessProfile = {
  businessName: '',
  taxIdType: 'osek_morshe',
  defaultLanguage: 'he',
}

export function parseBusinessProfile(raw: string | null | undefined): BusinessProfile {
  if (!raw) return { ...EMPTY_BUSINESS_PROFILE }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...EMPTY_BUSINESS_PROFILE }
    }
    return { ...EMPTY_BUSINESS_PROFILE, ...(parsed as BusinessProfile) }
  } catch {
    return { ...EMPTY_BUSINESS_PROFILE }
  }
}

export async function getBusinessProfile(
  db: ReturnType<typeof getDb> = getDb(),
): Promise<BusinessProfile> {
  try {
    const rows = await queryRows<{ businessProfile: string | null }>(
      db
        .select({ businessProfile: userSettings.businessProfile })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    return parseBusinessProfile(rows[0]?.businessProfile)
  } catch (err) {
    console.warn('[business-profile] get failed:', err)
    return { ...EMPTY_BUSINESS_PROFILE }
  }
}

export async function setBusinessProfile(
  profile: BusinessProfile,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<BusinessProfile> {
  const now = new Date().toISOString()
  const stored = JSON.stringify(profile)

  const rows = await queryRows<{ id: string }>(
    db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
  )

  if (rows[0]) {
    await db
      .update(userSettings)
      .set({ businessProfile: stored, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      businessProfile: stored,
      updatedAt: now,
    })
  }
  return profile
}

/** Frozen onto the document at issue time so later profile edits never rewrite history. */
export function buildIssuerSnapshot(profile: BusinessProfile) {
  return {
    businessName: profile.businessName,
    businessNameEn: profile.businessNameEn,
    ownerName: profile.ownerName,
    taxId: profile.taxId,
    taxIdType: profile.taxIdType,
    address: profile.address,
    addressEn: profile.addressEn,
    city: profile.city,
    zipCode: profile.zipCode,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    logoDataUrl: profile.logoDataUrl,
    bankDetails: profile.bankDetails,
    bankDetailsEn: profile.bankDetailsEn,
    footerText: profile.footerText,
    footerTextEn: profile.footerTextEn,
  }
}

export type IssuerSnapshot = ReturnType<typeof buildIssuerSnapshot>
