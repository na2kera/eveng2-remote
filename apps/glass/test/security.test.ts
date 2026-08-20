import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GLASSES_PERMISSION_REVIEW_CHARS,
  parseBridgeUrl,
  requiresCompanionReview,
} from '../src/security.js'

test('allows plaintext WebSocket only for loopback hosts', () => {
  assert.equal(parseBridgeUrl('ws://127.0.0.1:8787/ws').protocol, 'ws:')
  assert.equal(parseBridgeUrl('ws://localhost:8787/ws').protocol, 'ws:')
  assert.equal(parseBridgeUrl('wss://bridge.example.test/ws').protocol, 'wss:')
  assert.throws(() => parseBridgeUrl('ws://192.168.1.100:8787/ws'), /must use wss/)
  assert.throws(() => parseBridgeUrl('https://bridge.example.test/ws'), /ws:\/\/ or wss:\/\//)
})

test('requires companion review only when G2 would truncate the content', () => {
  assert.equal(requiresCompanionReview('a'.repeat(GLASSES_PERMISSION_REVIEW_CHARS), GLASSES_PERMISSION_REVIEW_CHARS), false)
  assert.equal(requiresCompanionReview('a'.repeat(GLASSES_PERMISSION_REVIEW_CHARS + 1), GLASSES_PERMISSION_REVIEW_CHARS), true)
})
