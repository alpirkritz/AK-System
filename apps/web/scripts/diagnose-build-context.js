'use strict';
// #region agent log — build-time diagnostic for Railway callback route (hypotheses H1–H5)
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
const callbackPath = path.join(cwd, 'src/app/api/auth/google-calendar/callback/route.ts');
const pkgPath = path.join(cwd, 'package.json');
const prefix = '[DEBUG 93817e]';

let lines = [];
try {
  const content = fs.readFileSync(callbackPath, 'utf8');
  lines = content.split('\n').slice(0, 5);
} catch (e) {
  lines = ['(file read error: ' + e.message + ')'];
}
console.log(prefix, 'callback route path:', callbackPath);
console.log(prefix, 'cwd:', cwd);
lines.forEach((line, i) => console.log(prefix, 'L' + (i + 1) + ':', line));

let hasGoogleapis = false;
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  hasGoogleapis = !!(pkg.dependencies && pkg.dependencies.googleapis);
} catch (e) {
  hasGoogleapis = false;
}
console.log(prefix, 'package.json has googleapis:', hasGoogleapis);

const logPath = path.join(cwd, '../../.cursor/debug-93817e.log');
const payload = {
  sessionId: '93817e',
  runId: 'build-diagnostic',
  hypothesisId: 'H1-H5',
  location: 'scripts/diagnose-build-context.js',
  message: 'Build context diagnostic',
  data: { cwd, callbackPath, line2: lines[1] || null, hasGoogleapis },
  timestamp: Date.now(),
};
try {
  fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
} catch (_) {}
fetch('http://127.0.0.1:7637/ingest/8e7d6bbb-fc02-4166-86b4-3d2987d50b3d', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '93817e' },
  body: JSON.stringify(payload),
}).catch(() => {});
// #endregion
