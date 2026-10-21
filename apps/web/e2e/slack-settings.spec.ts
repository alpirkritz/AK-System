import { test, expect } from '@playwright/test'

/**
 * E2E tests for the Slack integration settings page.
 * Uses API route mocking to avoid real Slack calls.
 */

test.describe('Slack settings — unconnected state', () => {
  test('shows connect button when no Slack connection exists', async ({ page }) => {
    await page.goto('/settings/slack')
    await expect(page.getByText('התחבר ל-Slack')).toBeVisible()
    await expect(page.getByText('חיבור')).toBeVisible()
  })

  test('shows channels tab as disabled until connected', async ({ page }) => {
    await page.goto('/settings/slack')
    await page.getByText('ערוצים').click()
    await expect(page.getByText('חבר את סלאק קודם')).toBeVisible()
  })
})

test.describe('Slack settings — channel management', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the Slack connection API
    await page.route('**/api/trpc/slack.getConnection*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { json: { connected: true, teamId: 'T123', teamName: 'Test Team', scopes: 'channels:read,channels:history' } } },
        }),
      }),
    )
    await page.route('**/api/trpc/slack.listChannels*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: {
              json: [
                {
                  id: 'sc_T123_C001',
                  teamId: 'T123',
                  channelId: 'C001',
                  name: 'general',
                  isPrivate: false,
                  enabled: false,
                  fomoEnabled: false,
                  fomoThreshold: 10,
                  fomoWindowMinutes: 5,
                  keywords: '[]',
                  lastFomoAlertAt: null,
                  updatedAt: new Date().toISOString(),
                },
              ],
            },
          },
        }),
      }),
    )
    await page.goto('/settings/slack')
  })

  test('shows team name when connected', async ({ page }) => {
    await expect(page.getByText('Test Team')).toBeVisible()
    await expect(page.getByText('Workspace מחובר · קריאה בלבד')).toBeVisible()
  })

  test('shows channel list when switching to channels tab', async ({ page }) => {
    await page.getByText('ערוצים').click()
    await expect(page.getByText('# general')).toBeVisible()
  })

  test('channel expand shows FOMO settings', async ({ page }) => {
    await page.getByText('ערוצים').click()
    await page.getByText('▼ הגדרות').click()
    await expect(page.getByText('FOMO')).toBeVisible()
    await expect(page.getByText('מילות מפתח')).toBeVisible()
  })
})
