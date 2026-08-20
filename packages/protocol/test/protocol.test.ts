import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../src/index.js'

test('client messages round-trip through the validator', () => {
  const messages: ClientMessage[] = [
    { type: 'client.hello', protocolVersion: PROTOCOL_VERSION, clientId: 'glass-1', token: 'client-token' },
    { type: 'permission.response', requestId: 'request-1', decision: 'allow' },
    { type: 'audio.start', sessionId: 'audio-1' },
    { type: 'audio.stop', sessionId: 'audio-1' },
    { type: 'audio.cancel', sessionId: 'audio-1' },
    { type: 'transcript.action', transcriptId: 'transcript-1', action: 'send' },
  ]

  for (const message of messages) {
    assert.deepEqual(parseClientMessage(encodeMessage(message)), { ok: true, value: message })
  }
  assert.equal(
    parseClientMessage(JSON.stringify({ type: 'audio.start', sessionId: 'audio-1', target: { surfaceId: 'x' } })).ok,
    false,
  )
})

test('server messages reject malformed payloads', () => {
  assert.deepEqual(parseServerMessage('{'), { ok: false, error: 'Message is not valid JSON.' })
  assert.equal(parseServerMessage(JSON.stringify({ type: 'error', message: 'missing fields' })).ok, false)
  assert.equal(
    parseServerMessage(
      JSON.stringify({ type: 'server.hello', protocolVersion: PROTOCOL_VERSION + 1, pendingPermissions: [] }),
    ).ok,
    false,
  )
})

test('server hello validates pending permission requests', () => {
  const message: ServerMessage = {
    type: 'server.hello',
    protocolVersion: PROTOCOL_VERSION,
    pendingPermissions: [
      {
        id: 'permission-1',
        source: 'claude',
        toolName: 'Bash',
        summary: 'npm install',
        target: { surfaceId: 'surface:1' },
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ],
  }

  assert.deepEqual(parseServerMessage(encodeMessage(message)), { ok: true, value: message })
})
