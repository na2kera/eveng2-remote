import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseClientMessage,
  type ClientMessage,
  type CmuxTarget,
  type ErrorMessage,
  type PermissionRequest,
  type ServerMessage,
} from '@eveng2-remote/protocol'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { CmuxController } from './cmux.js'
import type { BridgeConfig } from './config.js'
import { normalizePermissionHook } from './hook.js'
import type { Transcriber } from './whisper.js'

const MIN_RECORDING_BYTES = 3_200
const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024

interface PendingPermission {
  request: PermissionRequest
  processing: boolean
  settle(result: PermissionResult): void
}

type PermissionResult = 'allow' | 'deny' | 'expired' | 'cancelled'

interface Recording {
  sessionId: string
  chunks: Buffer[]
  totalBytes: number
  target: CmuxTarget
}

interface StoredTranscript {
  id: string
  sessionId: string
  text: string
  target: CmuxTarget
  createdAt: number
  processing: boolean
  owner: WebSocket
}

export interface BridgeDependencies {
  cmux: CmuxController
  transcriber: Transcriber
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface BridgeRuntime {
  server: Server
  listen(): Promise<void>
  close(): Promise<void>
  address(): string
}

export function createBridgeServer(config: BridgeConfig, dependencies: BridgeDependencies): BridgeRuntime {
  const log = dependencies.log ?? console
  const connections = new Set<WebSocket>()
  const clients = new Set<WebSocket>()
  const alive = new WeakMap<WebSocket, boolean>()
  const initializedClients = new WeakSet<WebSocket>()
  const authenticationTimers = new WeakMap<WebSocket, NodeJS.Timeout>()
  const recordings = new Map<WebSocket, Recording>()
  const pendingPermissions = new Map<string, PendingPermission>()
  const transcripts = new Map<string, StoredTranscript>()
  let lastTarget: CmuxTarget = {}
  let activeTranscriptions = 0

  const requestHandler = (request: IncomingMessage, response: ServerResponse) => {
    void handleHttp(request, response).catch(error => {
      log.error('HTTP handler failed:', error)
      if (!response.headersSent) writeJson(response, 500, { error: 'Internal server error.' })
      else response.end()
    })
  }
  const server = config.tlsCertPath && config.tlsKeyPath
    ? createHttpsServer(
        { cert: readFileSync(config.tlsCertPath), key: readFileSync(config.tlsKeyPath) },
        requestHandler,
      )
    : createHttpServer(requestHandler)
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: config.maxRecordingBytes })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://bridge.local')
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (connections.size >= config.maxClients) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    webSockets.handleUpgrade(request, socket, head, ws => webSockets.emit('connection', ws, request))
  })

  webSockets.on('connection', socket => {
    connections.add(socket)
    alive.set(socket, true)
    const authenticationTimer = setTimeout(() => socket.close(1008, 'Authentication timeout'), 5_000)
    authenticationTimer.unref()
    authenticationTimers.set(socket, authenticationTimer)
    socket.on('pong', () => alive.set(socket, true))
    socket.on('error', error => log.warn('WebSocket client error:', error))
    socket.on('close', () => {
      clearTimeout(authenticationTimers.get(socket))
      connections.delete(socket)
      clients.delete(socket)
      recordings.delete(socket)
    })
    socket.on('message', (data, isBinary) => {
      void handleWebSocketMessage(socket, data, isBinary).catch(error => {
        log.error('WebSocket message handler failed:', error)
        sendError(socket, 'internal_error', 'Bridge failed to process the message.', false)
      })
    })

  })

  const maintenanceTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, item] of pendingPermissions) {
      if (permissionExpired(item.request, now, config.permissionTtlMs)) settlePermission(id, item, 'expired')
    }
    for (const [id, transcript] of transcripts) {
      if (now - transcript.createdAt > config.permissionTtlMs) transcripts.delete(id)
    }
    for (const client of connections) {
      if (alive.get(client) === false) {
        client.terminate()
        continue
      }
      alive.set(client, false)
      client.ping()
    }
  }, 30_000)
  maintenanceTimer.unref()

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://bridge.local')
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        connectedClients: clients.size,
        pendingPermissions: pendingPermissions.size,
      })
      return
    }

    if (request.method === 'POST' && isHookPath(url.pathname)) {
      if (!requestIsAuthorized(request, config.hookToken)) {
        writeJson(response, 401, { error: 'Unauthorized.' })
        return
      }
      if (!request.headers['content-type']?.toLowerCase().includes('application/json')) {
        writeJson(response, 415, { error: 'Content-Type must be application/json.' })
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(request, config.maxHookBodyBytes)
      } catch (error) {
        writeJson(response, error instanceof BodyTooLargeError ? 413 : 400, {
          error: error instanceof Error ? error.message : 'Invalid request body.',
        })
        return
      }

      let permission: PermissionRequest
      try {
        permission = normalizePermissionHook(body)
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid hook body.' })
        return
      }
      if (pendingPermissions.has(permission.id)) {
        writeJson(response, 409, { error: 'A permission with this request ID already exists.' })
        return
      }

      if (pendingPermissions.size >= config.maxPendingPermissions) {
        writeJson(response, 429, { error: 'Too many permission requests are pending.' })
        return
      }

      let settle!: (result: PermissionResult) => void
      const resultPromise = new Promise<PermissionResult>(resolve => {
        let settled = false
        settle = result => {
          if (settled) return
          settled = true
          resolve(result)
        }
      })
      const pending: PendingPermission = { request: permission, processing: false, settle }
      pendingPermissions.set(permission.id, pending)
      broadcast({ type: 'permission.request', request: permission })
      response.once('close', () => {
        if (!response.writableEnded) settlePermission(permission.id, pending, 'cancelled')
      })
      const result = await resultPromise
      if (response.destroyed) return
      if (result === 'allow' || result === 'deny') {
        writeJson(response, 200, { decision: result, requestId: permission.id })
      } else if (result === 'expired') {
        writeJson(response, 408, { error: 'Permission request expired.', requestId: permission.id })
      } else {
        writeJson(response, 503, { error: 'Permission request was cancelled.', requestId: permission.id })
      }
      return
    }

    writeJson(response, 404, { error: 'Not found.' })
  }

  async function handleWebSocketMessage(socket: WebSocket, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) {
      if (!initializedClients.has(socket)) {
        sendError(socket, 'hello_required', 'Authenticate with client.hello before other messages.', false)
        socket.close(1008, 'client.hello required')
        return
      }
      handleAudioChunk(socket, data)
      return
    }

    const raw = rawDataToBuffer(data)
    if (raw.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
      sendError(socket, 'message_too_large', 'Control messages are limited to 64 KiB.', false)
      return
    }
    const parsed = parseClientMessage(raw.toString('utf8'))
    if (!parsed.ok) {
      sendError(socket, 'invalid_message', parsed.error, true)
      return
    }
    await handleClientMessage(socket, parsed.value)
  }

  async function handleClientMessage(socket: WebSocket, message: ClientMessage): Promise<void> {
    if (message.type === 'client.hello') {
      if (!tokenMatches(message.token, config.clientToken)) {
        sendError(socket, 'unauthorized', 'Client authentication failed.', false)
        socket.close(1008, 'Authentication failed')
        return
      }
      clearTimeout(authenticationTimers.get(socket))
      initializedClients.add(socket)
      clients.add(socket)
      send(socket, {
        type: 'server.hello',
        protocolVersion: PROTOCOL_VERSION,
        pendingPermissions: [...pendingPermissions.values()]
          .map(item => item.request)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      })
      return
    }
    if (!initializedClients.has(socket)) {
      sendError(socket, 'hello_required', 'Send a valid client.hello before other messages.', false)
      socket.close(1008, 'client.hello required')
      return
    }

    switch (message.type) {
      case 'permission.response':
        await respondToPermission(socket, message.requestId, message.decision)
        return
      case 'audio.start': {
        if (recordings.has(socket)) {
          sendError(socket, 'recording_in_progress', 'A recording is already active.', true, message.sessionId)
          return
        }
        let target: CmuxTarget
        try {
          target = dependencies.cmux.resolveTarget(lastTarget)
        } catch (error) {
          sendError(socket, 'target_required', errorMessage(error), true, message.sessionId)
          return
        }
        lastTarget = target
        recordings.set(socket, { sessionId: message.sessionId, chunks: [], totalBytes: 0, target })
        send(socket, { type: 'audio.started', sessionId: message.sessionId })
        return
      }
      case 'audio.stop':
        await stopRecording(socket, message.sessionId)
        return
      case 'audio.cancel': {
        const recording = recordings.get(socket)
        if (recording?.sessionId === message.sessionId) recordings.delete(socket)
        return
      }
      case 'transcript.action':
        await handleTranscriptAction(socket, message.transcriptId, message.action)
        return
    }
  }

  function handleAudioChunk(socket: WebSocket, data: RawData): void {
    const recording = recordings.get(socket)
    if (!recording) {
      sendError(socket, 'recording_not_started', 'Send audio.start before binary PCM frames.', true)
      return
    }
    const chunk = Buffer.from(rawDataToBuffer(data))
    if (recording.totalBytes + chunk.byteLength > config.maxRecordingBytes) {
      recordings.delete(socket)
      sendError(socket, 'recording_too_long', 'Recording exceeded the configured duration limit.', true, recording.sessionId)
      return
    }
    recording.chunks.push(chunk)
    recording.totalBytes += chunk.byteLength
  }

  async function stopRecording(socket: WebSocket, sessionId: string): Promise<void> {
    const recording = recordings.get(socket)
    if (!recording || recording.sessionId !== sessionId) {
      sendError(socket, 'recording_not_found', 'No matching recording session is active.', true, sessionId)
      return
    }
    recordings.delete(socket)
    if (recording.totalBytes < MIN_RECORDING_BYTES) {
      sendError(socket, 'recording_too_short', 'Record at least 100 ms of audio.', true, sessionId)
      return
    }

    if (activeTranscriptions >= config.maxConcurrentTranscriptions) {
      sendError(socket, 'transcription_busy', 'The transcription queue is full. Try again shortly.', true, sessionId)
      return
    }

    send(socket, { type: 'transcription.started', sessionId })
    let text: string
    activeTranscriptions += 1
    try {
      text = await dependencies.transcriber.transcribe(Buffer.concat(recording.chunks, recording.totalBytes))
    } catch (error) {
      sendError(socket, 'transcription_failed', errorMessage(error), true, sessionId)
      return
    } finally {
      activeTranscriptions -= 1
    }

    const transcriptId = randomUUID()
    transcripts.set(transcriptId, {
      id: transcriptId,
      sessionId,
      text,
      target: recording.target,
      createdAt: Date.now(),
      processing: false,
      owner: socket,
    })
    send(socket, { type: 'transcript.result', sessionId, transcriptId, text, target: recording.target })
  }

  async function handleTranscriptAction(
    socket: WebSocket,
    transcriptId: string,
    action: 'send' | 'retry',
  ): Promise<void> {
    const transcript = transcripts.get(transcriptId)
    if (!transcript) {
      sendError(socket, 'transcript_not_found', 'Transcript expired or does not exist.', true, transcriptId)
      return
    }
    if (transcript.owner !== socket) {
      sendError(socket, 'transcript_not_found', 'Transcript expired or does not exist.', true, transcriptId)
      return
    }
    if (transcript.processing) {
      sendError(socket, 'action_in_progress', 'This transcript is already being processed.', true, transcriptId)
      return
    }

    if (action === 'retry') {
      transcripts.delete(transcriptId)
      send(socket, {
        type: 'action.completed',
        action: 'voice.retry',
        requestId: transcriptId,
        message: 'Transcript discarded. Ready to record again.',
      })
      return
    }

    transcript.processing = true
    try {
      await dependencies.cmux.sendText(transcript.target, transcript.text)
      transcripts.delete(transcriptId)
      send(socket, {
        type: 'action.completed',
        action: 'voice.send',
        requestId: transcriptId,
        message: 'Voice command sent to cmux.',
      })
    } catch (error) {
      transcript.processing = false
      sendError(socket, 'cmux_send_failed', errorMessage(error), true, transcriptId)
    }
  }

  async function respondToPermission(
    socket: WebSocket,
    requestId: string,
    decision: 'allow' | 'deny',
  ): Promise<void> {
    const pending = pendingPermissions.get(requestId)
    if (!pending) {
      sendError(socket, 'permission_not_found', 'Permission request expired or does not exist.', true, requestId)
      return
    }
    if (permissionExpired(pending.request, Date.now(), config.permissionTtlMs)) {
      settlePermission(requestId, pending, 'expired')
      sendError(socket, 'permission_not_found', 'Permission request expired or does not exist.', true, requestId)
      return
    }
    if (pending.processing) {
      sendError(socket, 'action_in_progress', 'This permission is already being processed.', true, requestId)
      return
    }
    pending.processing = true
    if (pending.request.target.surfaceId || pending.request.target.workspaceId) lastTarget = pending.request.target
    settlePermission(requestId, pending, decision)
    broadcast({
      type: 'action.completed',
      action: 'permission',
      requestId,
      message: decision === 'allow' ? 'Permission allowed.' : 'Permission denied.',
    })
  }

  function broadcast(message: ServerMessage): void {
    for (const client of clients) send(client, message)
  }

  function settlePermission(id: string, pending: PendingPermission, result: PermissionResult): void {
    if (pendingPermissions.get(id) !== pending) return
    pendingPermissions.delete(id)
    pending.settle(result)
  }

  async function close(): Promise<void> {
    clearInterval(maintenanceTimer)
    for (const [id, pending] of pendingPermissions) settlePermission(id, pending, 'cancelled')
    for (const client of connections) client.terminate()
    webSockets.close()
    if (!server.listening) return
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  }

  return {
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.off('error', reject)
          resolve()
        })
      }),
    close,
    address: () => `${config.tlsCertPath ? 'https' : 'http'}://${config.host}:${config.port}`,
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message))
}

function sendError(
  socket: WebSocket,
  code: string,
  message: string,
  recoverable: boolean,
  requestId?: string,
): void {
  const error: ErrorMessage = { type: 'error', code, message, recoverable }
  if (requestId) error.requestId = requestId
  send(socket, error)
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function isHookPath(pathname: string): boolean {
  return pathname === '/hooks/permission' || pathname === '/hooks/claude'
}

function permissionExpired(request: PermissionRequest, now: number, ttlMs: number): boolean {
  const createdAt = Date.parse(request.createdAt)
  return !Number.isFinite(createdAt) || now - createdAt > ttlMs
}

function requestIsAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
  const header = request.headers['x-bridge-token']
  const candidate = bearer ?? (Array.isArray(header) ? header[0] : header)
  return tokenMatches(candidate, token)
}

function tokenMatches(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false
  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  response.end(JSON.stringify(body))
}

class BodyTooLargeError extends Error {}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    total += chunk.byteLength
    if (total > maxBytes) throw new BodyTooLargeError(`Request body exceeds ${maxBytes} bytes.`)
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks, total).toString('utf8')
  if (!body) throw new Error('Request body is empty.')
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('Request body is not valid JSON.')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
