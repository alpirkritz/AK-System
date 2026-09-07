import { test, expect } from '@playwright/test'

test.describe('Multi-level Sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3002/')
  })

  test('Settings defaults apply to Dashboard and Tasks page', async ({ page }) => {
    // 1. Go to Settings
    await page.goto('http://localhost:3002/settings')
    await page.waitForLoadState('networkidle')

    // 2. Find the מיון section and change dashboard tasks sort
    const dashboardSortSection = page.locator('[data-testid="dashboard-tasks-sort"]')
    
    // Change primary to "created_desc"
    const primarySelect = dashboardSortSection.locator('[data-testid="sort-primary"]')
    await primarySelect.selectOption({ label: 'נוצר (חדשות קודם)' })
    
    // Wait for success message
    await expect(page.locator('text=ברירת המחדל עודכנה')).toBeVisible({ timeout: 3000 })

    // 3. Navigate to Dashboard
    await page.goto('http://localhost:3002/')
    await page.waitForLoadState('networkidle')

    // Verify the sort control shows the new default
    const dashboardPrimary = page.locator('section[aria-label="משימות פתוחות"]').locator('select').first()
    await expect(dashboardPrimary).toHaveValue('created_desc')

    // 4. Override on Dashboard
    await dashboardPrimary.selectOption({ label: 'עדיפות (גבוהה קודם)' })
    
    // Reset button should appear
    await expect(page.locator('button:has-text("איפוס לברירת מחדל")')).toBeVisible()

    // 5. Click reset
    await page.locator('button:has-text("איפוס לברירת מחדל")').click()
    
    // Should return to server default
    await expect(dashboardPrimary).toHaveValue('created_desc')
    await expect(page.locator('button:has-text("איפוס לברירת מחדל")')).not.toBeVisible()
  })

  test('Tasks page grouping follows primary key', async ({ page }) => {
    await page.goto('http://localhost:3002/tasks')
    await page.waitForLoadState('networkidle')

    // Find the sort control
    const primarySelect = page.locator('[data-testid="sort-primary"]')
    
    // When primary is priority, should see priority sections (exact Hebrew labels)
    await primarySelect.selectOption({ label: 'עדיפות (גבוהה קודם)' })
    // Wait for page to re-render with grouping
    await page.waitForTimeout(1000)
    // The group labels are in uppercase spans (line 310 in tasks page)
    await expect(page.locator('span.uppercase:has-text("עדיפות גבוהה")')).toBeVisible()
    await expect(page.locator('span.uppercase:has-text("עדיפות בינונית")')).toBeVisible()
    
    // When primary is NOT priority, should be flat list with priority dots
    await primarySelect.selectOption({ label: 'תאריך יעד (קרוב)' })
    await page.waitForTimeout(500)
    
    // Priority section headers should NOT be visible
    await expect(page.locator('span.uppercase:has-text("עדיפות גבוהה")')).not.toBeVisible()
    
    // But priority dots should be visible in each row
    const firstTaskRow = page.locator('.task-row').first()
    await expect(firstTaskRow.locator('.w-2.h-2.rounded-full')).toBeVisible()
  })

  test('Then-by cannot repeat primary key', async ({ page }) => {
    await page.goto('http://localhost:3002/tasks')
    await page.waitForLoadState('networkidle')

    const primarySelect = page.locator('[data-testid="sort-primary"]')
    const thenBySelect = page.locator('[data-testid="sort-then-by"]')
    
    // Select priority as primary
    await primarySelect.selectOption({ label: 'עדיפות (גבוהה קודם)' })
    
    // Then-by should not have priority options
    const thenByOptions = await thenBySelect.locator('option').allTextContents()
    const hasPriorityOption = thenByOptions.some(opt => opt.includes('עדיפות'))
    expect(hasPriorityOption).toBe(false)
    
    // Should have "ללא" option
    const hasNoneOption = thenByOptions.some(opt => opt.includes('ללא'))
    expect(hasNoneOption).toBe(true)
  })

  test('Settings changes clear localStorage overrides', async ({ page }) => {
    // 1. Create a localStorage override on Dashboard
    await page.goto('http://localhost:3002/')
    await page.waitForLoadState('networkidle')
    
    const dashboardPrimary = page.locator('section[aria-label="משימות פתוחות"]').locator('[data-testid="sort-primary"]')
    await dashboardPrimary.selectOption({ label: 'עדיפות (גבוהה קודם)' })
    
    // Verify override is active (reset button visible)
    await expect(page.locator('button:has-text("איפוס לברירת מחדל")')).toBeVisible()

    // 2. Go to Settings and change the default
    await page.goto('http://localhost:3002/settings')
    const dashboardSortSection = page.locator('[data-testid="dashboard-tasks-sort"]')
    const settingsPrimary = dashboardSortSection.locator('[data-testid="sort-primary"]')
    await settingsPrimary.selectOption({ label: 'סטטוס (זרימת עבודה)' })
    
    await expect(page.locator('text=ברירת המחדל עודכנה')).toBeVisible({ timeout: 3000 })

    // 3. Go back to Dashboard - override should be cleared
    await page.goto('http://localhost:3002/')
    await page.waitForLoadState('networkidle')
    
    // Should show the new server default, not the old override
    await expect(dashboardPrimary).toHaveValue('status_workflow')
    
    // Reset button should NOT be visible
    await expect(page.locator('button:has-text("איפוס לברירת מחדל")')).not.toBeVisible()
  })
})
