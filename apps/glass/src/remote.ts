import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@eveng2-remote/protocol'
import { parseBridgeUrl } from './security'

export type RemoteConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface RemoteClientOptions {
  url: string
  token: string
  clientId: string
  onMessage(message: ServerMessage): void
  onStatus(state: RemoteConnectionState): void
  onProtocolError(message: string): void
}

const MAX_BUFFERED_AUDIO_BYTES = 512 * 1024

export class RemoteClient {
  private socket: WebSocket | null = null
  private retryTimer: number | null = null
  private retryAttempt = 0
  private stopped = true

  constructor(private readonly options: RemoteClientOptions) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (!this.stopped) return
    this.stopped = false
    this.open()
  }

  close(): void {
    this.stopped = true
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.socket?.close(1000, 'App closed')
    this.socket = null
  }

  send(message: ClientMessage): void {
    if (!this.connected || !this.socket) throw new Error('Bridge is not connected.')
    this.socket.send(encodeMessage(message))
  }

  sendAudio(chunk: Uint8Array): void {
    if (!this.connected || !this.socket) throw new Error('Bridge is not connected.')
    if (this.socket.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
      throw new Error('Audio upload cannot keep up with the microphone stream.')
    }
    this.socket.send(chunk)
  }

  private open(): void {
    if (this.stopped) return
    this.options.onStatus('connecting')

    let socket: WebSocket
    try {
      const url = parseBridgeUrl(this.options.url)
      socket = new WebSocket(url)
    } catch (error) {
      this.options.onProtocolError(error instanceof Error ? error.message : String(error))
      this.scheduleReconnect()
      return
    }

    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return
      this.retryAttempt = 0
      this.options.onStatus('connected')
      this.send({
        type: 'client.hello',
        protocolVersion: PROTOCOL_VERSION,
        clientId: this.options.clientId,
        token: this.options.token,
      })
    })
    socket.addEventListener('message', event => {
      if (socket !== this.socket || typeof event.data !== 'string') return
      const parsed = parseServerMessage(event.data)
      if (!parsed.ok) {
        this.options.onProtocolError(parsed.error)
        return
      }
      this.options.onMessage(parsed.value)
    })
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return
      this.socket = null
      this.options.onStatus('disconnected')
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      // The close event owns retry scheduling and user-visible state.
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== null) return
    const exponential = Math.min(30_000, 1_000 * 2 ** this.retryAttempt)
    const jitter = Math.floor(Math.random() * 500)
    this.retryAttempt += 1
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, exponential + jitter)
  }
}
