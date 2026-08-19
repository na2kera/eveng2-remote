import assert from 'node:assert/strict'
import test from 'node:test'
import { pcmToWav } from '../src/wav.js'

test('pcmToWav writes a 16 kHz mono 16-bit WAV header', () => {
  const pcm = Uint8Array.from([1, 2, 3, 4])
  const wav = pcmToWav(pcm)

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 16_000)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), pcm.byteLength)
  assert.deepEqual([...wav.subarray(44)], [...pcm])
})
