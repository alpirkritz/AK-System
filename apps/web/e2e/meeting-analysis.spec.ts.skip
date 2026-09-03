import { test, expect } from '@playwright/test'
import { devSession, seedData, cleanupSeededData } from './helpers'

test.describe('Meeting Analysis - Task Creation', () => {
  test.beforeEach(async ({ page }) => {
    await devSession(page)
  })

  test('should open pre-filled task modal when clicking single action item', async ({ page }) => {
    // Seed a meeting with analysis containing action items
    const meetingId = 'm_' + Date.now()
    const analysisId = 'ma_' + Date.now()
    
    await seedData({
      meetings: [
        {
          id: meetingId,
          title: 'Product Planning',
          date: '2026-09-05',
          time: '10:00',
          notes: 'Test meeting',
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      meetingAnalyses: [
        {
          id: analysisId,
          meetingId,
          source: 'notion_transcript',
          hatName: 'Product Management',
          topic: 'Feature prioritization',
          mood: 'focused',
          subtext: 'Team alignment',
          keyInsight: 'Need to focus on core features',
          score: 8,
          scoreRationale: 'Clear decisions made',
          kaizenKeep: 'Good facilitation',
          kaizenImprove: 'Better time management',
          openQuestion: 'How do we measure success?',
          participantsJson: JSON.stringify([{ name: 'Alice', confirmed: true }]),
          actionItemsJson: JSON.stringify([
            { content: 'Create ASAP user story for login', owner: 'Alice' },
            { content: 'Schedule design review', owner: 'Bob' },
          ]),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    // Navigate to meeting page
    await page.goto(`/meetings/${meetingId}`)

    // Wait for analysis to load
    await expect(page.getByText('ניתוח שיחה')).toBeVisible()

    // Click "צור משימה" on first action item (with ASAP keyword)
    await page.getByRole('button', { name: 'צור משימה' }).first().click()

    // Verify task modal opens
    await expect(page.getByText('משימה חדשה')).toBeVisible()

    // Verify pre-filled title
    await expect(page.getByPlaceholder('מה צריך לעשות?')).toHaveValue(
      'Create ASAP user story for login'
    )

    // Verify priority was set to high (due to ASAP keyword)
    await expect(
      page.locator('button[aria-pressed="true"]').filter({ hasText: 'דחוף' })
    ).toBeVisible()

    // Verify meeting link is present (date should match meeting date)
    const dueDateInput = page.locator('input[type="date"]')
    await expect(dueDateInput).toHaveValue('2026-09-05')

    // Clean up
    await cleanupSeededData({ meetingIds: [meetingId], meetingAnalysisIds: [analysisId] })
  })

  test('should create task and update analysis when saving from modal', async ({ page }) => {
    const meetingId = 'm_' + Date.now()
    const analysisId = 'ma_' + Date.now()

    await seedData({
      meetings: [
        {
          id: meetingId,
          title: 'Sprint Planning',
          date: '2026-09-04',
          time: '14:00',
          notes: '',
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      meetingAnalyses: [
        {
          id: analysisId,
          meetingId,
          source: 'notion_transcript',
          hatName: 'Agile',
          topic: 'Sprint scope',
          mood: 'collaborative',
          subtext: '',
          keyInsight: 'Team has capacity',
          score: 7,
          scoreRationale: 'Good planning',
          kaizenKeep: 'Clear goals',
          kaizenImprove: 'Estimate accuracy',
          openQuestion: 'Can we deliver on time?',
          participantsJson: '[]',
          actionItemsJson: JSON.stringify([
            { content: 'Write integration tests', owner: null },
          ]),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByText('ניתוח שיחה')).toBeVisible()

    // Open task modal
    await page.getByRole('button', { name: 'צור משימה' }).click()
    await expect(page.getByText('משימה חדשה')).toBeVisible()

    // Edit title slightly
    const titleInput = page.getByPlaceholder('מה צריך לעשות?')
    await titleInput.fill('Write integration tests for API')

    // Save
    await page.getByRole('button', { name: 'שמור' }).click()

    // Verify modal closes
    await expect(page.getByText('משימה חדשה')).not.toBeVisible({ timeout: 5000 })

    // Verify action item now shows "✓ נוצר"
    await expect(page.getByText('✓ נוצר')).toBeVisible()

    await cleanupSeededData({ meetingIds: [meetingId], meetingAnalysisIds: [analysisId] })
  })

  test('should open batch modal with all unassigned action items', async ({ page }) => {
    const meetingId = 'm_' + Date.now()
    const analysisId = 'ma_' + Date.now()

    await seedData({
      meetings: [
        {
          id: meetingId,
          title: 'Team Retrospective',
          date: '2026-09-03',
          time: '16:00',
          notes: '',
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      meetingAnalyses: [
        {
          id: analysisId,
          meetingId,
          source: 'notion_transcript',
          hatName: 'Coaching',
          topic: 'Process improvements',
          mood: 'reflective',
          subtext: '',
          keyInsight: 'Communication can improve',
          score: 6,
          scoreRationale: 'Some actionable items',
          kaizenKeep: 'Open feedback',
          kaizenImprove: 'Follow through',
          openQuestion: 'What prevents us from improving?',
          participantsJson: '[]',
          actionItemsJson: JSON.stringify([
            { content: 'Update team wiki', owner: null },
            { content: 'Schedule 1:1s', owner: null },
            { content: 'Review code standards', owner: null },
          ]),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByText('ניתוח שיחה')).toBeVisible()

    // Click "צור הכל"
    await page.getByRole('button', { name: 'צור הכל' }).click()

    // Verify batch modal opens
    await expect(page.getByText('צור משימות מאקשן אייטמס')).toBeVisible()
    await expect(page.getByText('3 פריטים')).toBeVisible()

    // Verify all items are listed and checked by default
    await expect(page.getByDisplayValue('Update team wiki')).toBeVisible()
    await expect(page.getByDisplayValue('Schedule 1:1s')).toBeVisible()
    await expect(page.getByDisplayValue('Review code standards')).toBeVisible()

    // All checkboxes should be checked
    const checkboxes = page.locator('input[type="checkbox"]')
    await expect(checkboxes).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(checkboxes.nth(i)).toBeChecked()
    }

    await cleanupSeededData({ meetingIds: [meetingId], meetingAnalysisIds: [analysisId] })
  })

  test('should allow editing items in batch modal before creating', async ({ page }) => {
    const meetingId = 'm_' + Date.now()
    const analysisId = 'ma_' + Date.now()

    await seedData({
      meetings: [
        {
          id: meetingId,
          title: 'Design Review',
          date: '2026-09-06',
          time: '11:00',
          notes: '',
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      meetingAnalyses: [
        {
          id: analysisId,
          meetingId,
          source: 'notion_transcript',
          hatName: 'Design',
          topic: 'UI improvements',
          mood: 'creative',
          subtext: '',
          keyInsight: 'Focus on user flow',
          score: 8,
          scoreRationale: 'Good ideas',
          kaizenKeep: 'Visual examples',
          kaizenImprove: 'Technical feasibility',
          openQuestion: 'How do we validate with users?',
          participantsJson: '[]',
          actionItemsJson: JSON.stringify([
            { content: 'Create mockups', owner: null },
            { content: 'User testing', owner: null },
          ]),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    await page.goto(`/meetings/${meetingId}`)
    await page.getByRole('button', { name: 'צור הכל' }).click()

    // Edit first item title
    const firstTitleInput = page.getByDisplayValue('Create mockups')
    await firstTitleInput.fill('Create high-fidelity mockups in Figma')

    // Uncheck second item
    const secondCheckbox = page.locator('input[type="checkbox"]').nth(1)
    await secondCheckbox.uncheck()

    // Verify button shows only 1 task will be created
    await expect(page.getByRole('button', { name: 'צור 1 משימות' })).toBeVisible()

    // Save
    await page.getByRole('button', { name: 'צור 1 משימות' }).click()

    // Verify modal closes
    await expect(page.getByText('צור משימות מאקשן אייטמס')).not.toBeVisible({ timeout: 5000 })

    // Verify first item shows as created
    const actionItems = page.locator('text=✓ נוצר')
    await expect(actionItems.first()).toBeVisible()

    // Second item should still have "צור משימה" button (was unchecked)
    await expect(page.getByRole('button', { name: 'צור משימה' })).toBeVisible()

    await cleanupSeededData({ meetingIds: [meetingId], meetingAnalysisIds: [analysisId] })
  })

  test('should set priority to high when action item contains urgent keywords', async ({
    page,
  }) => {
    const meetingId = 'm_' + Date.now()
    const analysisId = 'ma_' + Date.now()

    await seedData({
      meetings: [
        {
          id: meetingId,
          title: 'Incident Response',
          date: '2026-09-03',
          time: '09:00',
          notes: '',
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      meetingAnalyses: [
        {
          id: analysisId,
          meetingId,
          source: 'notion_transcript',
          hatName: 'Operations',
          topic: 'Production issue',
          mood: 'urgent',
          subtext: '',
          keyInsight: 'Need faster response',
          score: 5,
          scoreRationale: 'Stressful but handled',
          kaizenKeep: 'Quick mobilization',
          kaizenImprove: 'Better monitoring',
          openQuestion: 'How do we prevent this?',
          participantsJson: '[]',
          actionItemsJson: JSON.stringify([
            { content: 'Fix critical bug ASAP', owner: null },
            { content: 'Deploy hotfix היום', owner: null },
            { content: 'Update documentation', owner: null },
          ]),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    await page.goto(`/meetings/${meetingId}`)
    await page.getByRole('button', { name: 'צור הכל' }).click()

    // First two items should have high priority (ASAP, היום keywords)
    // Third should have medium priority

    // Verify first item has high priority selected
    const firstItemPriority = page
      .locator('.modal')
      .locator('[style*="border-color"]')
      .filter({ hasText: 'דחוף' })
      .first()
    await expect(firstItemPriority).toHaveCSS('border-color', /rgb\(239, 68, 68\)/)

    await cleanupSeededData({ meetingIds: [meetingId], meetingAnalysisIds: [analysisId] })
  })
})
