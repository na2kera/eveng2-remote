import assert from 'node:assert/strict'
import test from 'node:test'
import { WhisperClient } from '../src/whisper.js'

test('sends WAV multipart fields and normalizes whisper text to one line', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  let capturedForm: FormData | undefined
  globalThis.fetch = (async (_input, init) => {
    capturedForm = init?.body as FormData
    return new Response(JSON.stringify({ text: '  npm test\nを実行して  ' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const client = new WhisperClient({
    url: 'http://127.0.0.1:8080/inference',
    language: 'ja',
    prompt: 'TypeScript, cmux',
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
  })
  const transcript = await client.transcribe(Uint8Array.from([1, 2, 3, 4]))

  assert.equal(transcript, 'npm test を実行して')
  assert.equal(capturedForm?.get('language'), 'ja')
  assert.equal(capturedForm?.get('prompt'), 'TypeScript, cmux')
  assert.equal(capturedForm?.get('response_format'), 'json')
  const file = capturedForm?.get('file')
  assert.ok(file instanceof Blob)
  const wav = Buffer.from(await file.arrayBuffer())
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
})

test('rejects an empty transcript', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 })) as typeof fetch

  const client = new WhisperClient({
    url: 'http://127.0.0.1:8080/inference',
    language: 'ja',
    prompt: '',
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
  })
  await assert.rejects(() => client.transcribe(Uint8Array.from([1, 2])), /empty transcript/)
})

test('rejects a whisper response larger than the configured limit', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: 'too large' }), { status: 200 })) as typeof fetch

  const client = new WhisperClient({
    url: 'http://127.0.0.1:8080/inference',
    language: 'ja',
    prompt: '',
    timeoutMs: 1_000,
    maxResponseBytes: 4,
  })
  await assert.rejects(() => client.transcribe(Uint8Array.from([1, 2])), /response exceeds 4 bytes/)
})
