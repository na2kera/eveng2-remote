export const PROTOCOL_VERSION = 1 as const
export const PCM_SAMPLE_RATE = 16_000 as const
export const PCM_CHANNELS = 1 as const
export const PCM_BITS_PER_SAMPLE = 16 as const
export const MAX_TRANSCRIPT_CHARS = 2_000 as const

/** Raw WebSocket binary frames sent between audio.start and audio.stop. */
export type AudioChunk = Uint8Array

export type PermissionDecision = 'allow' | 'deny'
export type TranscriptAction = 'send' | 'retry'

export interface CmuxTarget {
  surfaceId?: string
  workspaceId?: string
}

export interface PermissionRequest {
  id: string
  source: string
  toolName: string
  summary: string
  target: CmuxTarget
  createdAt: string
}

export interface ClientHelloMessage {
  type: 'client.hello'
  protocolVersion: typeof PROTOCOL_VERSION
  clientId: string
}

export interface PermissionResponseMessage {
  type: 'permission.response'
  requestId: string
  decision: PermissionDecision
}

export interface AudioStartMessage {
  type: 'audio.start'
  sessionId: string
  target?: CmuxTarget
}

export interface AudioStopMessage {
  type: 'audio.stop'
  sessionId: string
}

export interface AudioCancelMessage {
  type: 'audio.cancel'
  sessionId: string
}

export interface TranscriptActionMessage {
  type: 'transcript.action'
  transcriptId: string
  action: TranscriptAction
}

export type ClientMessage =
  | ClientHelloMessage
  | PermissionResponseMessage
  | AudioStartMessage
  | AudioStopMessage
  | AudioCancelMessage
  | TranscriptActionMessage

export interface ServerHelloMessage {
  type: 'server.hello'
  protocolVersion: typeof PROTOCOL_VERSION
  pendingPermissions: PermissionRequest[]
}

export interface PermissionRequestMessage {
  type: 'permission.request'
  request: PermissionRequest
}

export interface AudioStartedMessage {
  type: 'audio.started'
  sessionId: string
}

export interface TranscriptionStartedMessage {
  type: 'transcription.started'
  sessionId: string
}

export interface TranscriptResultMessage {
  type: 'transcript.result'
  sessionId: string
  transcriptId: string
  text: string
  target: CmuxTarget
}

export interface ActionCompletedMessage {
  type: 'action.completed'
  action: 'permission' | 'voice.send' | 'voice.retry'
  requestId: string
  message: string
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
  requestId?: string
  recoverable: boolean
}

export type ServerMessage =
  | ServerHelloMessage
  | PermissionRequestMessage
  | AudioStartedMessage
  | TranscriptionStartedMessage
  | TranscriptResultMessage
  | ActionCompletedMessage
  | ErrorMessage

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown, maxLength = 2_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isTarget(value: unknown): value is CmuxTarget {
  if (!isRecord(value)) return false
  const { surfaceId, workspaceId } = value
  return (
    (surfaceId === undefined || isNonEmptyString(surfaceId, 160)) &&
    (workspaceId === undefined || isNonEmptyString(workspaceId, 160))
  )
}

function isPermissionRequest(value: unknown): value is PermissionRequest {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id, 160) &&
    isNonEmptyString(value.source, 80) &&
    isNonEmptyString(value.toolName, 160) &&
    typeof value.summary === 'string' &&
    value.summary.length <= 2_000 &&
    isTarget(value.target) &&
    isNonEmptyString(value.createdAt, 80)
  )
}

function decodeJson(input: string): ParseResult<Record<string, unknown>> {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return { ok: false, error: 'Message is not valid JSON.' }
  }
  return isRecord(value)
    ? { ok: true, value }
    : { ok: false, error: 'Message must be a JSON object.' }
}

export function parseClientMessage(input: string): ParseResult<ClientMessage> {
  const parsed = decodeJson(input)
  if (!parsed.ok) return parsed
  const value = parsed.value

  switch (value.type) {
    case 'client.hello':
      return value.protocolVersion === PROTOCOL_VERSION && isNonEmptyString(value.clientId, 160)
        ? { ok: true, value: value as unknown as ClientHelloMessage }
        : { ok: false, error: 'Invalid client.hello message.' }
    case 'permission.response':
      return isNonEmptyString(value.requestId, 160) && (value.decision === 'allow' || value.decision === 'deny')
        ? { ok: true, value: value as unknown as PermissionResponseMessage }
        : { ok: false, error: 'Invalid permission.response message.' }
    case 'audio.start':
      return isNonEmptyString(value.sessionId, 160) && (value.target === undefined || isTarget(value.target))
        ? { ok: true, value: value as unknown as AudioStartMessage }
        : { ok: false, error: 'Invalid audio.start message.' }
    case 'audio.stop':
    case 'audio.cancel':
      return isNonEmptyString(value.sessionId, 160)
        ? { ok: true, value: value as unknown as AudioStopMessage | AudioCancelMessage }
        : { ok: false, error: `Invalid ${value.type} message.` }
    case 'transcript.action':
      return isNonEmptyString(value.transcriptId, 160) && (value.action === 'send' || value.action === 'retry')
        ? { ok: true, value: value as unknown as TranscriptActionMessage }
        : { ok: false, error: 'Invalid transcript.action message.' }
    default:
      return { ok: false, error: 'Unknown client message type.' }
  }
}

export function parseServerMessage(input: string): ParseResult<ServerMessage> {
  const parsed = decodeJson(input)
  if (!parsed.ok) return parsed
  const value = parsed.value

  switch (value.type) {
    case 'server.hello':
      return value.protocolVersion === PROTOCOL_VERSION &&
        Array.isArray(value.pendingPermissions) &&
        value.pendingPermissions.every(isPermissionRequest)
        ? { ok: true, value: value as unknown as ServerHelloMessage }
        : { ok: false, error: 'Invalid server.hello message.' }
    case 'permission.request':
      return isPermissionRequest(value.request)
        ? { ok: true, value: value as unknown as PermissionRequestMessage }
        : { ok: false, error: 'Invalid permission.request message.' }
    case 'audio.started':
    case 'transcription.started':
      return isNonEmptyString(value.sessionId, 160)
        ? { ok: true, value: value as unknown as AudioStartedMessage | TranscriptionStartedMessage }
        : { ok: false, error: `Invalid ${value.type} message.` }
    case 'transcript.result':
      return isNonEmptyString(value.sessionId, 160) &&
        isNonEmptyString(value.transcriptId, 160) &&
        isNonEmptyString(value.text, MAX_TRANSCRIPT_CHARS) &&
        isTarget(value.target)
        ? { ok: true, value: value as unknown as TranscriptResultMessage }
        : { ok: false, error: 'Invalid transcript.result message.' }
    case 'action.completed':
      return (value.action === 'permission' || value.action === 'voice.send' || value.action === 'voice.retry') &&
        isNonEmptyString(value.requestId, 160) &&
        isNonEmptyString(value.message, 1_000)
        ? { ok: true, value: value as unknown as ActionCompletedMessage }
        : { ok: false, error: 'Invalid action.completed message.' }
    case 'error':
      return isNonEmptyString(value.code, 160) &&
        isNonEmptyString(value.message, 2_000) &&
        (value.requestId === undefined || isNonEmptyString(value.requestId, 160)) &&
        typeof value.recoverable === 'boolean'
        ? { ok: true, value: value as unknown as ErrorMessage }
        : { ok: false, error: 'Invalid error message.' }
    default:
      return { ok: false, error: 'Unknown server message type.' }
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message)
}
