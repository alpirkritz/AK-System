import { config } from './config.js'
import { createServer } from './server.js'
import { listEnabledGroupJids, loadPersistedGroupConfig } from './group-config.js'
import { dmAllowlistSize, loadPersistedDmConfig } from './dm-capture.js'
import { startWhatsAppClient, startPersistFlushLoop } from './whatsapp-client.js'

async function main(): Promise<void> {
  // SELF_JID is auto-detected after QR pairing — never block HTTP/QR startup.
  console.log(`[whatsapp-bridge] Starting on port ${config.port}`)
  console.log(`[whatsapp-bridge] Auth state: ${config.authStatePath}`)
  console.log(`[whatsapp-bridge] Config: ${config.configPath}`)
  console.log(`[whatsapp-bridge] Auto-reply: ${config.replyEnabled ? 'ON (self-chat only)' : 'OFF'}`)
  if (config.akWebhookUrl) {
    try {
      console.log(`[whatsapp-bridge] AK webhook: ${new URL(config.akWebhookUrl).host}/api/whatsapp/webhook`)
    } catch {
      console.log(`[whatsapp-bridge] AK webhook: ${config.akWebhookUrl}`)
    }
  } else {
    console.warn('[whatsapp-bridge] AK_WEBHOOK_URL not set — inbound WhatsApp will not reach AK System')
  }

  // Restore watched-group config from disk so alerts/summaries survive restarts.
  loadPersistedGroupConfig()
  loadPersistedDmConfig()
  const watchedGroups = listEnabledGroupJids().length
  const dmAllowlist = dmAllowlistSize()
  if (watchedGroups === 0 || dmAllowlist === 0) {
    console.warn(
      `[whatsapp-bridge] Capture lists are partly empty (groups=${watchedGroups}, dm=${dmAllowlist}) — re-push config from AK System`,
    )
  } else {
    console.log(`[whatsapp-bridge] Capture lists: groups=${watchedGroups}, dm=${dmAllowlist}`)
  }

  void startWhatsAppClient()

  // Periodically flush watched-group messages to the AK database for insights.
  startPersistFlushLoop()

  const app = createServer()
  app.listen(config.port, () => {
    console.log(`[whatsapp-bridge] Open http://localhost:${config.port}/ to pair`)
  })
}

main().catch((err) => {
  console.error('[whatsapp-bridge] Fatal:', err)
  process.exit(1)
})
