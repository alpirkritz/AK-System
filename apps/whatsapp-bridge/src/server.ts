import express, { type NextFunction, type Request, type Response } from 'express'
import QRCode from 'qrcode'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, isSelfChatJid } from './config.js'
import { listWatchedGroupsWithCounts } from './group-buffer.js'
import {
  getCurrentQr,
  getSelfJid,
  getStatus,
  requestGroupSummary,
  sendWhatsAppMessage,
} from './whatsapp-client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization
  const token = auth?.replace(/^Bearer\s+/i, '')
  if (token !== config.bridgeSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

export function createServer(): express.Application {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/status', (_req, res) => {
    res.json(getStatus())
  })

  app.get('/qr', async (_req, res) => {
    const qr = getCurrentQr()
    if (!qr) {
      const status = getStatus()
      if (status.connected) {
        return res.json({ connected: true, selfJid: status.selfJid })
      }
      return res.json({ connected: false, qr: null, message: 'Waiting for QR — refresh in a few seconds' })
    }
    const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 })
    res.json({ connected: false, qr: dataUrl })
  })

  app.get('/', (_req, res) => {
    const htmlPath = join(__dirname, '..', 'public', 'index.html')
    res.type('html').send(readFileSync(htmlPath, 'utf8'))
  })

  app.post('/send', requireAuth, async (req, res) => {
    try {
      const text = String(req.body?.text ?? '').trim()
      if (!text) {
        res.status(400).json({ error: 'text is required' })
        return
      }
      const to = String(req.body?.to ?? getSelfJid())
      if (!isSelfChatJid(to)) {
        res.status(403).json({ error: 'Outbound send blocked — self-chat JIDs only' })
        return
      }
      await sendWhatsAppMessage(to, text)
      res.json({ ok: true, to })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed'
      res.status(503).json({ error: msg })
    }
  })

  app.get('/groups', requireAuth, (_req, res) => {
    res.json({
      groups: listWatchedGroupsWithCounts(config.watchGroupJids),
      watchList: Array.from(config.watchGroupJids),
    })
  })

  app.post('/groups/summarize', requireAuth, async (req, res) => {
    const groupJid = String(req.body?.groupJid ?? '').trim()
    if (!groupJid) {
      res.status(400).json({ error: 'groupJid is required' })
      return
    }
    const result = await requestGroupSummary(groupJid)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  })

  app.post('/groups/summarize-all', requireAuth, async (_req, res) => {
    const results: Record<string, { ok: boolean; error?: string }> = {}
    for (const groupJid of config.watchGroupJids) {
      results[groupJid] = await requestGroupSummary(groupJid)
    }
    res.json({ results })
  })

  return app
}
