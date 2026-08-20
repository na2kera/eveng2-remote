import { PCM_BITS_PER_SAMPLE, PCM_CHANNELS, PCM_SAMPLE_RATE } from '@eveng2-remote/protocol'

export interface BridgeConfig {
  host: string
  port: number
  clientToken: string
  hookToken: string
  tlsCertPath?: string
  tlsKeyPath?: string
  whisperUrl: string
  whisperLanguage: string
  whisperPrompt: string
  whisperTimeoutMs: number
  maxWhisperResponseBytes: number
  maxRecordingBytes: number
  maxClients: number
  maxPendingPermissions: number
  maxConcurrentTranscriptions: number
  cmuxBin: string
  cmuxDefaultSurface?: string
  cmuxDefaultWorkspace?: string
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
  const clientToken = required('BRIDGE_CLIENT_TOKEN')
  const hookToken = required('BRIDGE_HOOK_TOKEN')
  if (clientToken.length < 32) throw new Error('BRIDGE_CLIENT_TOKEN must be at least 32 characters.')
  if (hookToken.length < 32) throw new Error('BRIDGE_HOOK_TOKEN must be at least 32 characters.')
  if (clientToken.length > 512) throw new Error('BRIDGE_CLIENT_TOKEN must not exceed 512 characters.')
  if (hookToken.length > 512) throw new Error('BRIDGE_HOOK_TOKEN must not exceed 512 characters.')
  if (clientToken === hookToken) throw new Error('BRIDGE_CLIENT_TOKEN and BRIDGE_HOOK_TOKEN must differ.')

  const host = process.env.BRIDGE_HOST?.trim() || '127.0.0.1'
  const tlsCertPath = optional('BRIDGE_TLS_CERT_PATH')
  const tlsKeyPath = optional('BRIDGE_TLS_KEY_PATH')
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new Error('BRIDGE_TLS_CERT_PATH and BRIDGE_TLS_KEY_PATH must be configured together.')
  }
  if (!isLoopbackHost(host) && !tlsCertPath) {
    throw new Error('TLS certificate and key are required when BRIDGE_HOST is not loopback.')
  }

  const maxRecordingSeconds = positiveInteger('MAX_RECORDING_SECONDS', 30, 300)
  const bytesPerSecond = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8)

  return {
    host,
    port: positiveInteger('BRIDGE_PORT', 8787, 65_535),
    clientToken,
    hookToken,
    tlsCertPath,
    tlsKeyPath,
    whisperUrl: process.env.WHISPER_URL?.trim() || 'http://127.0.0.1:8080/inference',
    whisperLanguage: process.env.WHISPER_LANGUAGE?.trim() || 'ja',
    whisperPrompt:
      process.env.WHISPER_PROMPT?.trim() ||
      'Claude Code, Codex, cmux, TypeScript, Vite, useEffect, package.json, npm',
    whisperTimeoutMs: positiveInteger('WHISPER_TIMEOUT_MS', 120_000, 600_000),
    maxWhisperResponseBytes: positiveInteger('MAX_WHISPER_RESPONSE_BYTES', 64 * 1024, 1024 * 1024),
    maxRecordingBytes: maxRecordingSeconds * bytesPerSecond,
    maxClients: positiveInteger('MAX_CLIENTS', 4, 32),
    maxPendingPermissions: positiveInteger('MAX_PENDING_PERMISSIONS', 32, 256),
    maxConcurrentTranscriptions: positiveInteger('MAX_CONCURRENT_TRANSCRIPTIONS', 1, 8),
    cmuxBin: process.env.CMUX_BIN?.trim() || 'cmux',
    cmuxDefaultSurface: optional('CMUX_DEFAULT_SURFACE'),
    cmuxDefaultWorkspace: optional('CMUX_DEFAULT_WORKSPACE'),
    permissionTtlMs: positiveInteger('PERMISSION_TTL_MS', 60_000, 5 * 60_000),
    maxHookBodyBytes: positiveInteger('MAX_HOOK_BODY_BYTES', 256 * 1024, 4 * 1024 * 1024),
  }
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}
