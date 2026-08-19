import { PCM_BITS_PER_SAMPLE, PCM_CHANNELS, PCM_SAMPLE_RATE } from '@eveng2-remote/protocol'

const WAV_HEADER_SIZE = 44

export function pcmToWav(pcm: Uint8Array): Buffer {
  const bytesPerSample = PCM_BITS_PER_SAMPLE / 8
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNELS * bytesPerSample
  const blockAlign = PCM_CHANNELS * bytesPerSample
  const wav = Buffer.allocUnsafe(WAV_HEADER_SIZE + pcm.byteLength)

  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + pcm.byteLength, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(PCM_CHANNELS, 22)
  wav.writeUInt32LE(PCM_SAMPLE_RATE, 24)
  wav.writeUInt32LE(byteRate, 28)
  wav.writeUInt16LE(blockAlign, 32)
  wav.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(pcm.byteLength, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(wav, WAV_HEADER_SIZE)

  return wav
}
