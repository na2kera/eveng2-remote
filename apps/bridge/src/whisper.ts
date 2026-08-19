import { MAX_TRANSCRIPT_CHARS } from '@eveng2-remote/protocol'
import { pcmToWav } from './wav.js'

export interface WhisperOptions {
  url: string
  language: string
  prompt: string
  timeoutMs: number
}

export interface Transcriber {
  transcribe(pcm: Uint8Array): Promise<string>
}

export class WhisperClient implements Transcriber {
  constructor(private readonly options: WhisperOptions) {}

  async transcribe(pcm: Uint8Array): Promise<string> {
    const wav = pcmToWav(pcm)
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'recording.wav')
    form.set('response_format', 'json')
    form.set('language', this.options.language)
    if (this.options.prompt) form.set('prompt', this.options.prompt)

    let response: Response
    try {
      response = await fetch(this.options.url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      throw new Error(`whisper-server request failed: ${errorMessage(error)}`)
    }

    const body = await response.text()
    if (!response.ok) {
      throw new Error(`whisper-server returned HTTP ${response.status}: ${body.slice(0, 500)}`)
    }

    let text: string
    try {
      const parsed = JSON.parse(body) as unknown
      text = extractText(parsed)
    } catch (error) {
      throw new Error(`Invalid whisper-server response: ${errorMessage(error)}`)
    }

    const normalized = text.trim().replace(/\s+/gu, ' ')
    if (!normalized) throw new Error('whisper-server returned an empty transcript.')
    if (normalized.length > MAX_TRANSCRIPT_CHARS) {
      throw new Error(`Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`)
    }
    return normalized
  }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) throw new Error('Expected a JSON object with a text field.')
  const text = (value as Record<string, unknown>).text
  if (typeof text !== 'string') throw new Error('Expected a string text field.')
  return text
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
