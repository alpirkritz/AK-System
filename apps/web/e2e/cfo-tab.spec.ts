import { test, expect } from '@playwright/test'

test.describe('CFO Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to finance page
    await page.goto('http://localhost:3002/finance?tab=cfo')
    
    // Wait for page to load
    await page.waitForSelector('h2:has-text("לוח בקרה CFO")')
  })

  test('tab loads successfully', async ({ page }) => {
    // Check that CFO tab content is visible
    await expect(page.locator('h2:has-text("לוח בקרה CFO")')).toBeVisible()
    
    // Check that dashboard cards are present
    await expect(page.locator('text=מזומן חופשי חודשי')).toBeVisible()
    await expect(page.locator('text=מצב חובות')).toBeVisible()
    await expect(page.locator('text=סטטוס סוויפ')).toBeVisible()
  })

  test('section navigation works', async ({ page }) => {
    // Navigate to Leak Hunter section
    await page.click('button:has-text("ציד דליפות")')
    await expect(page.locator('h2:has-text("ציד דליפות")')).toBeVisible()
    
    // Navigate to Debt section
    await page.click('button:has-text("תוכנית פירעון חובות")')
    await expect(page.locator('h2:has-text("תוכנית פירעון חובות")')).toBeVisible()
    
    // Navigate to Liquidity section
    await page.click('button:has-text("סוויפ נזילות")')
    await expect(page.locator('h2:has-text("סוויפ נזילות תלת-שכבתי")')).toBeVisible()
    
    // Navigate to Pension section
    await page.click('button:has-text("ביקורת פנסיה")')
    await expect(page.locator('h2:has-text("ביקורת פנסיה וחסכון ארוך טווח")')).toBeVisible()
    
    // Navigate to Monthly Review section
    await page.click('button:has-text("סקירה חודשית")')
    await expect(page.locator('h2:has-text("סקירה חודשית")')).toBeVisible()
  })

  test('debt list displays correctly when empty', async ({ page }) => {
    // Navigate to debt section
    await page.click('button:has-text("תוכנית פירעון חובות")')
    
    // Should show "no debts" message
    await expect(page.locator('text=אין חובות')).toBeVisible()
  })

  test('pension list displays correctly when empty', async ({ page }) => {
    // Navigate to pension section
    await page.click('button:has-text("ביקורת פנסיה")')
    
    // Should show "no policies" message
    await expect(page.locator('text=לא הוגדרו פוליסות')).toBeVisible()
  })

  test('liquidity sweep shows layer breakdown', async ({ page }) => {
    // Navigate to liquidity section
    await page.click('button:has-text("סוויפ נזילות")')
    
    // Check that all three layers are displayed
    await expect(page.locator('text=Layer 1: תפעולי')).toBeVisible()
    await expect(page.locator('text=Layer 2: חירום')).toBeVisible()
    await expect(page.locator('text=Layer 3: מתוכנן')).toBeVisible()
  })
})
