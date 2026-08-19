import { PCM_BITS_PER_SAMPLE, PCM_CHANNELS, PCM_SAMPLE_RATE } from '@eveng2-remote/protocol'

export interface BridgeConfig {
  host: string
  port: number
  token: string
  whisperUrl: string
  whisperLanguage: string
  whisperPrompt: string
  whisperTimeoutMs: number
  maxRecordingBytes: number
  cmuxBin: string
  cmuxDefaultSurface?: string
  cmuxDefaultWorkspace?: string
  cmuxAllowInput: string
  cmuxDenyInput: string
  permissionTtlMs: number
  maxHookBodyBytes: number
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function positiveInteger(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

export function loadConfig(): BridgeConfig {
  const token = required('BRIDGE_TOKEN')
  if (token.length < 16) throw new Error('BRIDGE_TOKEN must be at least 16 characters.')

  const maxRecordingSeconds = positiveInteger('MAX_RECORDING_SECONDS', 30, 300)
  const bytesPerSecond = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8)

  return {
    host: process.env.BRIDGE_HOST?.trim() || '0.0.0.0',
    port: positiveInteger('BRIDGE_PORT', 8787, 65_535),
    token,
    whisperUrl: process.env.WHISPER_URL?.trim() || 'http://127.0.0.1:8080/inference',
    whisperLanguage: process.env.WHISPER_LANGUAGE?.trim() || 'ja',
    whisperPrompt:
      process.env.WHISPER_PROMPT?.trim() ||
      'Claude Code, Codex, cmux, TypeScript, Vite, useEffect, package.json, npm',
    whisperTimeoutMs: positiveInteger('WHISPER_TIMEOUT_MS', 120_000, 600_000),
    maxRecordingBytes: maxRecordingSeconds * bytesPerSecond,
    cmuxBin: process.env.CMUX_BIN?.trim() || 'cmux',
    cmuxDefaultSurface: optional('CMUX_DEFAULT_SURFACE'),
    cmuxDefaultWorkspace: optional('CMUX_DEFAULT_WORKSPACE'),
    cmuxAllowInput: process.env.CMUX_ALLOW_INPUT || 'y',
    cmuxDenyInput: process.env.CMUX_DENY_INPUT || 'n',
    permissionTtlMs: positiveInteger('PERMISSION_TTL_MS', 10 * 60_000, 24 * 60 * 60_000),
    maxHookBodyBytes: positiveInteger('MAX_HOOK_BODY_BYTES', 256 * 1024, 4 * 1024 * 1024),
  }
}
