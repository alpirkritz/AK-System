#!/usr/bin/env node
/**
 * Release notes for a deploy: what changed since the last deployed commit, written in Hebrew
 * for the owner, saved under deploy/releases/ and mailed through Mail.app.
 *
 *   node scripts/release-notes.mjs              build, save and send
 *   node scripts/release-notes.mjs --dry-run    build and save only
 *   node scripts/release-notes.mjs --since <sha>
 *
 * Env: RELEASE_NOTES_TO (default alpirkritz@gmail.com), GEMINI_API_KEY / GEMINI_MODEL (else read
 * from deploy/production.env), RELEASE_NOTES_BUILD_ID (shown in the header).
 * Releases are numbered 1, 2, 3 … by local git tags `release-N` placed on the deployed commit once
 * the mail went out; the next number and the commit range both come from the latest tag.
 * Never exits non-zero for a delivery problem: the deploy has already succeeded.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASES_DIR = path.join(ROOT, 'deploy', 'releases')
const DEFAULT_RECIPIENT = 'alpirkritz@gmail.com'
const FALLBACK_COMMITS = 10

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

/** Release numbers already used, from tags named `release-<n>`. */
export function releaseNumbers(tags) {
  return tags
    .map((t) => /^release-(\d+)$/.exec(t.trim())?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b)
}

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Parses `git log --format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e`. */
export function parseGitLog(raw) {
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, author, date, subject, body = ''] = r.split('\x1f')
      return {
        hash,
        short: hash.slice(0, 7),
        author,
        date,
        subject: subject.trim(),
        body: body.replace(/\n?Co-Authored-By:.*$/gim, '').trim(),
      }
    })
}

const SECTION_META = {
  new: { title: 'חדש', color: '#0d9488', bg: '#ccfbf1' },
  improved: { title: 'שופר', color: '#2563eb', bg: '#dbeafe' },
  fixed: { title: 'תוקן', color: '#b45309', bg: '#fef3c7' },
  internal: { title: 'מאחורי הקלעים', color: '#475569', bg: '#e2e8f0' },
}
const SECTION_ORDER = ['new', 'improved', 'fixed', 'internal']

/** Fallback when no summary is available: one line per commit, grouped by its leading verb. */
export function fallbackSummary(commits) {
  const kindOf = (s) =>
    /^(fix|repair|correct|prevent|stop)/i.test(s) ? 'fixed'
    : /^(add|let|show|build|introduce|ship|create)/i.test(s) ? 'new'
    : /^(refactor|chore|bump|update deps|test)/i.test(s) ? 'internal'
    : 'improved'
  const sections = {}
  for (const c of commits) (sections[kindOf(c.subject)] ??= []).push({ text: c.subject })
  return {
    headline: `${commits.length} שינויים עלו לאוויר`,
    intro: 'סיכום אוטומטי מתוך כותרות השינויים.',
    sections: SECTION_ORDER.filter((k) => sections[k]).map((kind) => ({ kind, items: sections[kind] })),
    needsAction: [],
  }
}

/** Keeps only well-formed content from the summary, whatever the model returned. */
export function normalizeSummary(raw, commits) {
  if (!raw || typeof raw !== 'object') return fallbackSummary(commits)
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((s) => SECTION_META[s?.kind] && Array.isArray(s.items))
    .map((s) => ({
      kind: s.kind,
      items: s.items
        .filter((i) => i && typeof i.text === 'string' && i.text.trim())
        .map((i) => ({ text: i.text.trim(), detail: typeof i.detail === 'string' ? i.detail.trim() : '' })),
    }))
    .filter((s) => s.items.length > 0)
    .sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind))
  if (sections.length === 0) return fallbackSummary(commits)
  return {
    headline: typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.trim() : `${commits.length} שינויים עלו לאוויר`,
    intro: typeof raw.intro === 'string' ? raw.intro.trim() : '',
    sections,
    needsAction: (Array.isArray(raw.needsAction) ? raw.needsAction : []).filter((x) => typeof x === 'string' && x.trim()),
  }
}

export function renderHtml({ summary, commits, meta }) {
  const sectionHtml = summary.sections
    .map((s) => {
      const m = SECTION_META[s.kind]
      const items = s.items
        .map(
          (i) =>
            `<tr><td style="padding:6px 0 6px 0;font-size:15px;line-height:1.6;color:#0f172a;">` +
            `<span style="color:${m.color};font-weight:700;">•</span>&nbsp;${esc(i.text)}` +
            (i.detail ? `<div style="font-size:13px;line-height:1.5;color:#64748b;padding-right:14px;">${esc(i.detail)}</div>` : '') +
            `</td></tr>`,
        )
        .join('')
      return (
        `<tr><td style="padding:22px 28px 0 28px;">` +
        `<span style="display:inline-block;background:${m.bg};color:${m.color};font-weight:700;font-size:12px;letter-spacing:.5px;padding:3px 12px;border-radius:999px;">${m.title}</span>` +
        `<table role="presentation" width="100%" style="margin-top:8px;">${items}</table></td></tr>`
      )
    })
    .join('')

  const actions = summary.needsAction.length
    ? `<tr><td style="padding:22px 28px 0 28px;"><div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:14px 18px;">` +
      `<div style="font-weight:700;color:#92400e;margin-bottom:6px;">דורש פעולה ממך</div>` +
      summary.needsAction.map((a) => `<div style="font-size:14px;line-height:1.6;color:#78350f;">• ${esc(a)}</div>`).join('') +
      `</div></td></tr>`
    : ''

  const dirty = meta.uncommitted
    ? `<tr><td style="padding:16px 28px 0 28px;"><div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 16px;font-size:13px;color:#991b1b;">שים לב: בעת הדיפלוי היו ${meta.uncommitted} קבצים עם שינויים שלא נכנסו ל-commit, ולכן מה שעלה עשוי לכלול יותר ממה שמפורט כאן.</div></td></tr>`
    : ''

  const commitRows = commits
    .map(
      (c) =>
        `<tr><td style="padding:3px 0;font-size:12px;color:#64748b;"><code style="background:#f1f5f9;border-radius:4px;padding:1px 6px;color:#334155;">${esc(c.short)}</code>&nbsp;${esc(c.subject)}</td></tr>`,
    )
    .join('')

  return (
    `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${esc(meta.subject)}</title></head>` +
    `<body style="margin:0;padding:24px 12px;background:#eef2f7;font-family:-apple-system,'Segoe UI',Arial,'Noto Sans Hebrew',sans-serif;direction:rtl;">` +
    `<table role="presentation" align="center" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08);">` +
    `<tr><td style="background:#0f766e;background-image:linear-gradient(135deg,#0f766e,#2dd4bf);padding:28px;color:#ffffff;">` +
    `<div style="font-size:13px;letter-spacing:1px;opacity:.9;">ARO · גרסה ${meta.version} עלתה</div>` +
    `<div style="font-size:24px;font-weight:800;line-height:1.3;margin-top:6px;">${esc(summary.headline)}</div>` +
    `<div style="font-size:13px;opacity:.9;margin-top:10px;">${esc(meta.dateLabel)} · גרסה ${meta.version} · build ${esc(meta.build)} · ${commits.length} שינויים</div>` +
    `</td></tr>` +
    (summary.intro ? `<tr><td style="padding:22px 28px 0 28px;font-size:15px;line-height:1.7;color:#334155;">${esc(summary.intro)}</td></tr>` : '') +
    dirty + actions + sectionHtml +
    `<tr><td style="padding:26px 28px 8px 28px;"><div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:12px;font-weight:700;color:#475569;">כל השינויים בגרסה</div>` +
    `<table role="presentation" width="100%" style="margin-top:6px;">${commitRows}</table></td></tr>` +
    `<tr><td style="padding:14px 28px 24px 28px;font-size:11px;color:#94a3b8;">נשלח אוטומטית בסיום הדיפלוי.</td></tr>` +
    `</table></body></html>`
  )
}

export function renderText({ summary, commits, meta }) {
  const lines = [`ARO · גרסה ${meta.version} עלתה`, summary.headline, `${meta.dateLabel} · גרסה ${meta.version} · build ${meta.build} · ${commits.length} שינויים`, '']
  if (summary.intro) lines.push(summary.intro, '')
  if (meta.uncommitted) lines.push(`שים לב: ${meta.uncommitted} קבצים שלא נכנסו ל-commit נשלחו בדיפלוי.`, '')
  if (summary.needsAction.length) lines.push('דורש פעולה ממך:', ...summary.needsAction.map((a) => `  • ${a}`), '')
  for (const s of summary.sections) {
    lines.push(SECTION_META[s.kind].title + ':')
    for (const i of s.items) lines.push(`  • ${i.text}${i.detail ? ` — ${i.detail}` : ''}`)
    lines.push('')
  }
  lines.push('כל השינויים:', ...commits.map((c) => `  ${c.short} ${c.subject}`))
  return lines.join('\n')
}

const SUMMARY_PROMPT = `You write release notes for the owner of a personal workspace app (Hebrew UI). He is the product owner and not interested in code.
From the commits below, write the notes in natural Hebrew, in product language: what he can now do or see, not how it was built.
- Merge commits about the same feature into one item. One short sentence per item; add "detail" only when it helps (a place to find it).
- kind: "new" (new ability), "improved" (existing thing works better), "fixed" (a problem is gone), "internal" (tests, tooling, refactors; keep to one or two lines).
- "needsAction": only things the commit messages explicitly require from the owner (install a new APK, apply a database change by hand, set a variable). Otherwise an empty array.
- "headline": under 60 characters. "intro": one or two sentences.
Return JSON only: {"headline": string, "intro": string, "sections": [{"kind": "new"|"improved"|"fixed"|"internal", "items": [{"text": string, "detail": string}]}], "needsAction": string[]}.`

function readProductionEnv(key) {
  try {
    const m = fs.readFileSync(path.join(ROOT, 'deploy', 'production.env'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

async function summarizeWithGemini(commits, files) {
  const apiKey = process.env.GEMINI_API_KEY || readProductionEnv('GEMINI_API_KEY')
  if (!apiKey) return null
  const model = process.env.GEMINI_MODEL || readProductionEnv('GEMINI_MODEL') || 'gemini-2.5-flash'
  const input =
    commits.map((c) => `- ${c.subject}${c.body ? `\n${c.body}` : ''}`).join('\n') +
    `\n\nChanged files (names only):\n${files.slice(0, 120).join('\n')}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90_000)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${SUMMARY_PROMPT}\n\nCOMMITS:\n${input}` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return JSON.parse(text)
  } catch (err) {
    console.warn(`[release-notes] summary unavailable (${err instanceof Error ? err.message : err}); using commit titles`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function sendWithMail({ to, subject, htmlPath, textPath }) {
  const script = `
on run argv
  set htmlText to read (POSIX file (item 1 of argv)) as «class utf8»
  set plainText to read (POSIX file (item 2 of argv)) as «class utf8»
  tell application "Mail"
    set msg to make new outgoing message with properties {visible:false, subject:(item 3 of argv), content:plainText}
    set html content of msg to htmlText
    tell msg to make new to recipient at end of to recipients with properties {address:(item 4 of argv)}
    send msg
  end tell
end run`
  execFileSync('osascript', ['-e', script, htmlPath, textPath, subject, to], { stdio: 'inherit' })
}

/** Latest release tag, its commit, and the number the next release gets. */
export function pickRange() {
  const head = git('rev-parse', 'HEAD')
  const numbers = releaseNumbers(git('tag', '--list', 'release-*').split('\n'))
  const last = numbers.at(-1)
  const base = last ? git('rev-list', '-n', '1', `release-${last}`) : ''
  return { head, base, next: (last ?? 0) + 1 }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const sinceIdx = args.indexOf('--since')
  const { head, base: taggedBase, next: version } = pickRange()
  const base = sinceIdx >= 0 ? args[sinceIdx + 1] : taggedBase

  const logArgs = ['log', '--no-merges', '--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e']
  const raw = base ? git(...logArgs, `${base}..${head}`) : git(...logArgs, `-n`, String(FALLBACK_COMMITS))
  const commits = parseGitLog(raw)
  if (commits.length === 0) {
    console.log('[release-notes] no new commits since the last deploy; nothing to send')
    return
  }
  const files = base ? git('diff', '--name-only', `${base}..${head}`).split('\n').filter(Boolean) : []
  // Editor and OS noise (.DS_Store, Cursor logs) is not a code change worth warning about.
  const uncommitted = git('diff', '--name-only', 'HEAD').split('\n').filter((f) => f && !/(^|\/)\.DS_Store$|^\.cursor\//.test(f)).length

  const now = new Date()
  const meta = {
    version,
    build: process.env.RELEASE_NOTES_BUILD_ID || head.slice(0, 7),
    dateLabel: now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    uncommitted,
    subject: `ARO · גרסה ${version} · ${now.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} · ${head.slice(0, 7)}`,
  }
  const summary = normalizeSummary(await summarizeWithGemini(commits, files), commits)
  const html = renderHtml({ summary, commits, meta })
  const text = renderText({ summary, commits, meta })

  fs.mkdirSync(RELEASES_DIR, { recursive: true })
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const htmlPath = path.join(RELEASES_DIR, `v${version}-${stamp}-${head.slice(0, 7)}.html`)
  const textPath = htmlPath.replace(/\.html$/, '.txt')
  fs.writeFileSync(htmlPath, html)
  fs.writeFileSync(textPath, text)
  console.log(`[release-notes] release ${version}: saved ${path.relative(ROOT, htmlPath)}`)

  if (dryRun) return
  const to = process.env.RELEASE_NOTES_TO || DEFAULT_RECIPIENT
  sendWithMail({ to, subject: meta.subject, htmlPath, textPath })
  // The mail is out: this commit is now release <version>. An existing tag is left alone.
  try {
    git('tag', `release-${version}`, head)
  } catch {
    console.warn(`[release-notes] could not tag release-${version}`)
  }
  console.log(`[release-notes] release ${version} sent to ${to}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.warn(`[release-notes] not sent: ${err instanceof Error ? err.message : err}`)
  })
}
