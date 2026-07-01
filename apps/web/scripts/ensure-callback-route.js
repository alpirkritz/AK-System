'use strict';
// Verifies callback route imports from @ak-system/api (Railway/build cache guard).
const fs = require('fs');
const path = require('path');
const callbackPath = path.join(process.cwd(), 'src/app/api/auth/google-calendar/callback/route.ts');

if (!fs.existsSync(callbackPath)) {
  console.error('[ensure-callback-route] missing', callbackPath);
  process.exit(1);
}

const content = fs.readFileSync(callbackPath, 'utf8');
if (!content.includes("from '@ak-system/api'")) {
  console.error('[ensure-callback-route] callback must import exchangeGoogleCalendarCode from @ak-system/api');
  process.exit(1);
}

if (!content.includes('upsertGoogleCalendarConnection')) {
  console.error('[ensure-callback-route] callback must upsert via upsertGoogleCalendarConnection')
  process.exit(1);
}

console.log('[ensure-callback-route] OK');
