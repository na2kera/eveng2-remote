import 'dotenv/config'
import { CmuxClient } from './cmux.js'
import { loadConfig } from './config.js'
import { createBridgeServer } from './server.js'
import { WhisperClient } from './whisper.js'

const config = loadConfig()
const cmux = new CmuxClient({
  binary: config.cmuxBin,
  defaultSurface: config.cmuxDefaultSurface,
  defaultWorkspace: config.cmuxDefaultWorkspace,
})
const transcriber = new WhisperClient({
  url: config.whisperUrl,
  language: config.whisperLanguage,
  prompt: config.whisperPrompt,
  timeoutMs: config.whisperTimeoutMs,
  maxResponseBytes: config.maxWhisperResponseBytes,
})
const bridge = createBridgeServer(config, { cmux, transcriber })

await bridge.listen()
console.info(`Even G2 bridge listening on ${bridge.address()}`)
console.info(`WebSocket endpoint: ${config.tlsCertPath ? 'wss' : 'ws'}://<this-mac>:${config.port}/ws`)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`Received ${signal}; shutting down.`)
  await bridge.close()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
