/** Shared localStorage keys across the app */
export const LS = {
  CONFLICT_ENABLED:  'ak:conflict-enabled',
  CONFLICT_DAYS:     'ak:conflict-days',
  CONFLICT_CALENDARS:'ak:conflict-calendars',
  CONFLICT_DISMISSED:'ak:conflict-dismissed',
  DASHBOARD_UPCOMING:'ak:dashboard-upcoming-count',
  DASHBOARD_TASKS_SORT: 'ak:dashboard-tasks-sort',
  SYNC_CALENDARS:    'ak:sync-calendars',
  TIMEZONE:          'ak:timezone',
} as const
