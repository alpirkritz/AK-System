import { config } from './config.js'
import { createServer } from './server.js'
import { startWhatsAppClient } from './whatsapp-client.js'

async function main(): Promise<void> {
  // SELF_JID is auto-detected after QR pairing — never block HTTP/QR startup.
  console.log(`[whatsapp-bridge] Starting on port ${config.port}`)
  console.log(`[whatsapp-bridge] Auth state: ${config.authStatePath}`)
  console.log(`[whatsapp-bridge] Auto-reply: ${config.replyEnabled ? 'ON (self-chat only)' : 'OFF'}`)

  void startWhatsAppClient()

  const app = createServer()
  app.listen(config.port, () => {
    console.log(`[whatsapp-bridge] Open http://localhost:${config.port}/ to pair`)
  })
}

main().catch((err) => {
  console.error('[whatsapp-bridge] Fatal:', err)
  process.exit(1)
})
