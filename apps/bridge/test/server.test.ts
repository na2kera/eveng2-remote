import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseServerMessage,
  type CmuxTarget,
  type ServerMessage,
} from '@eveng2-remote/protocol'
import WebSocket from 'ws'
import type { CmuxController } from '../src/cmux.js'
import type { BridgeConfig } from '../src/config.js'
import { createBridgeServer } from '../src/server.js'

const CLIENT_TOKEN = 'test-client-token-at-least-32-characters'
const HOOK_TOKEN = 'test-hook-token-different-and-at-least-32-characters'

test('runs permission and voice command flows end-to-end', async t => {
  const sentTexts: Array<{ target: CmuxTarget; text: string }> = []
  const cmux: CmuxController = {
    resolveTarget(target = {}) {
      if (!target.surfaceId && !target.workspaceId) throw new Error('target missing')
      return target
    },
    async sendText(target, text) {
      sentTexts.push({ target, text })
    },
  }
  const config = createTestConfig()
  const runtime = createBridgeServer(config, {
    cmux,
    transcriber: { transcribe: async () => 'npm test を実行して' },
    log: { info() {}, warn() {}, error() {} },
  })
  await runtime.listen()
  t.after(() => runtime.close())

  const address = runtime.server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
  const inbox = createInbox(ws)
  t.after(() => ws.terminate())

  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(
    encodeMessage({
      type: 'client.hello',
      protocolVersion: PROTOCOL_VERSION,
      clientId: 'test-client',
      token: CLIENT_TOKEN,
    }),
  )
  const hello = await inbox.next('server.hello')
  assert.equal(hello.protocolVersion, PROTOCOL_VERSION)

  ws.send(encodeMessage({ type: 'audio.start', sessionId: 'no-target' }))
  const targetError = await inbox.next('error')
  assert.equal(targetError.code, 'target_required')

  const unauthorized = await fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(unauthorized.status, 401)

  const clientCredentialRejected = await fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CLIENT_TOKEN}`, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(clientCredentialRejected.status, 401)

  const unauthenticatedWs = new WebSocket(
    `ws://127.0.0.1:${address.port}/ws?token=${encodeURIComponent(CLIENT_TOKEN)}`,
  )
  const unauthenticatedInbox = createInbox(unauthenticatedWs)
  t.after(() => unauthenticatedWs.terminate())
  await new Promise<void>((resolve, reject) => {
    unauthenticatedWs.once('open', resolve)
    unauthenticatedWs.once('error', reject)
  })
  unauthenticatedWs.send(encodeMessage({ type: 'audio.start', sessionId: 'query-token-is-not-auth' }))
  assert.equal((await unauthenticatedInbox.next('error')).code, 'hello_required')

  const acceptedPromise = fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { authorization: `Bearer ${HOOK_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'permission-1',
      toolName: 'Bash',
      summary: 'npm install',
      surfaceId: 'surface:7',
    }),
  })
  const request = await inbox.next('permission.request')
  assert.equal(request.request.id, 'permission-1')

  const duplicate = await fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { authorization: `Bearer ${HOOK_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'permission-1', toolName: 'Bash', surfaceId: 'surface:7' }),
  })
  assert.equal(duplicate.status, 409)

  ws.send(encodeMessage({ type: 'permission.response', requestId: 'permission-1', decision: 'allow' }))
  const permissionDone = await inbox.next('action.completed')
  assert.equal(permissionDone.action, 'permission')
  const accepted = await acceptedPromise
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { decision: 'allow', requestId: 'permission-1' })

  ws.send(encodeMessage({ type: 'audio.start', sessionId: 'audio-1' }))
  await inbox.next('audio.started')
  ws.send(Buffer.alloc(3_200, 1))
  ws.send(encodeMessage({ type: 'audio.stop', sessionId: 'audio-1' }))
  await inbox.next('transcription.started')
  const transcript = await inbox.next('transcript.result')
  assert.equal(transcript.text, 'npm test を実行して')

  ws.send(encodeMessage({ type: 'transcript.action', transcriptId: transcript.transcriptId, action: 'send' }))
  const voiceDone = await inbox.next('action.completed')
  assert.equal(voiceDone.action, 'voice.send')
  assert.deepEqual(sentTexts, [{ target: { surfaceId: 'surface:7' }, text: 'npm test を実行して' }])

  ws.send(encodeMessage({ type: 'audio.start', sessionId: 'too-short' }))
  await inbox.next('audio.started')
  ws.send(Buffer.alloc(100, 1))
  ws.send(encodeMessage({ type: 'audio.stop', sessionId: 'too-short' }))
  const shortError = await inbox.next('error')
  assert.equal(shortError.code, 'recording_too_short')

  ws.send(encodeMessage({ type: 'audio.start', sessionId: 'too-long' }))
  await inbox.next('audio.started')
  ws.send(Buffer.alloc(40_000, 1))
  ws.send(Buffer.alloc(40_000, 1))
  const longError = await inbox.next('error')
  assert.equal(longError.code, 'recording_too_long')

  ws.send(encodeMessage({ type: 'audio.start', sessionId: 'retry-audio' }))
  await inbox.next('audio.started')
  ws.send(Buffer.alloc(3_200, 1))
  ws.send(encodeMessage({ type: 'audio.stop', sessionId: 'retry-audio' }))
  await inbox.next('transcription.started')
  const retryTranscript = await inbox.next('transcript.result')
  ws.send(
    encodeMessage({ type: 'transcript.action', transcriptId: retryTranscript.transcriptId, action: 'retry' }),
  )
  const retryDone = await inbox.next('action.completed')
  assert.equal(retryDone.action, 'voice.retry')
  assert.equal(sentTexts.length, 1)
})

test('limits concurrent transcriptions', async t => {
  let finishTranscription!: (text: string) => void
  const transcription = new Promise<string>(resolve => {
    finishTranscription = resolve
  })
  const cmux: CmuxController = {
    resolveTarget(target = {}) {
      return target.surfaceId || target.workspaceId ? target : { surfaceId: 'surface:default' }
    },
    async sendText() {},
  }
  const runtime = createBridgeServer(createTestConfig({ maxConcurrentTranscriptions: 1 }), {
    cmux,
    transcriber: { transcribe: async () => transcription },
    log: { info() {}, warn() {}, error() {} },
  })
  await runtime.listen()
  t.after(() => runtime.close())
  const address = runtime.server.address() as AddressInfo
  const first = await connectClient(address.port, 'first-client')
  const second = await connectClient(address.port, 'second-client')
  t.after(() => first.socket.terminate())
  t.after(() => second.socket.terminate())

  first.socket.send(encodeMessage({ type: 'audio.start', sessionId: 'first' }))
  await first.inbox.next('audio.started')
  first.socket.send(Buffer.alloc(3_200, 1))
  first.socket.send(encodeMessage({ type: 'audio.stop', sessionId: 'first' }))
  await first.inbox.next('transcription.started')

  second.socket.send(encodeMessage({ type: 'audio.start', sessionId: 'second' }))
  await second.inbox.next('audio.started')
  second.socket.send(Buffer.alloc(3_200, 1))
  second.socket.send(encodeMessage({ type: 'audio.stop', sessionId: 'second' }))
  assert.equal((await second.inbox.next('error')).code, 'transcription_busy')

  finishTranscription('done')
  assert.equal((await first.inbox.next('transcript.result')).text, 'done')
})

function createTestConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    clientToken: CLIENT_TOKEN,
    hookToken: HOOK_TOKEN,
    whisperUrl: 'http://127.0.0.1:8080/inference',
    whisperLanguage: 'ja',
    whisperPrompt: '',
    whisperTimeoutMs: 1_000,
    maxWhisperResponseBytes: 64 * 1024,
    maxRecordingBytes: 64_000,
    maxClients: 4,
    maxPendingPermissions: 32,
    maxConcurrentTranscriptions: 1,
    cmuxBin: 'cmux',
    permissionTtlMs: 60_000,
    maxHookBodyBytes: 64 * 1024,
    ...overrides,
  }
}

async function connectClient(port: number, clientId: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const inbox = createInbox(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(encodeMessage({ type: 'client.hello', protocolVersion: PROTOCOL_VERSION, clientId, token: CLIENT_TOKEN }))
  await inbox.next('server.hello')
  return { socket, inbox }
}

function createInbox(socket: WebSocket) {
  const messages: ServerMessage[] = []
  const waiters = new Map<string, Array<(message: ServerMessage) => void>>()

  socket.on('message', data => {
    const parsed = parseServerMessage(data.toString())
    if (!parsed.ok) throw new Error(parsed.error)
    const waiter = waiters.get(parsed.value.type)?.shift()
    if (waiter) waiter(parsed.value)
    else messages.push(parsed.value)
  })

  return {
    next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
      const index = messages.findIndex(message => message.type === type)
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2_000)
        const listeners = waiters.get(type) ?? []
        listeners.push(message => {
          clearTimeout(timer)
          resolve(message as Extract<ServerMessage, { type: T }>)
        })
        waiters.set(type, listeners)
      })
    },
  }
}
