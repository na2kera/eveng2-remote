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

const TOKEN = 'test-token-at-least-16-characters'

test('runs permission and voice command flows end-to-end', async t => {
  const permissionResponses: Array<{ target: CmuxTarget; decision: string }> = []
  const sentTexts: Array<{ target: CmuxTarget; text: string }> = []
  const cmux: CmuxController = {
    resolveTarget(target = {}) {
      if (!target.surfaceId && !target.workspaceId) throw new Error('target missing')
      return target
    },
    async respondToPermission(target, decision) {
      permissionResponses.push({ target, decision })
    },
    async sendText(target, text) {
      sentTexts.push({ target, text })
    },
  }
  const config: BridgeConfig = {
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    whisperUrl: 'http://127.0.0.1:8080/inference',
    whisperLanguage: 'ja',
    whisperPrompt: '',
    whisperTimeoutMs: 1_000,
    maxRecordingBytes: 64_000,
    cmuxBin: 'cmux',
    cmuxAllowInput: 'y',
    cmuxDenyInput: 'n',
    permissionTtlMs: 60_000,
    maxHookBodyBytes: 64 * 1024,
  }
  const runtime = createBridgeServer(config, {
    cmux,
    transcriber: { transcribe: async () => 'npm test を実行して' },
    log: { info() {}, warn() {}, error() {} },
  })
  await runtime.listen()
  t.after(() => runtime.close())

  const address = runtime.server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${encodeURIComponent(TOKEN)}`)
  const inbox = createInbox(ws)
  t.after(() => ws.terminate())

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

  const accepted = await fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'permission-1',
      toolName: 'Bash',
      summary: 'npm install',
      surfaceId: 'surface:7',
    }),
  })
  assert.equal(accepted.status, 202)
  const request = await inbox.next('permission.request')
  assert.equal(request.request.id, 'permission-1')

  const duplicate = await fetch(`${baseUrl}/hooks/permission`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'permission-1', toolName: 'Bash', surfaceId: 'surface:7' }),
  })
  assert.equal(duplicate.status, 409)

  ws.send(encodeMessage({ type: 'permission.response', requestId: 'permission-1', decision: 'allow' }))
  const permissionDone = await inbox.next('action.completed')
  assert.equal(permissionDone.action, 'permission')
  assert.deepEqual(permissionResponses, [{ target: { surfaceId: 'surface:7' }, decision: 'allow' }])

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
