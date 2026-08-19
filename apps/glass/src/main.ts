import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { PermissionRequest, ServerMessage } from '@eveng2-remote/protocol'
import { eventTypeOf } from './input'
import { RemoteClient, type RemoteConnectionState } from './remote'
import { mountUi, renderUi, type UiView } from './ui'

type HubBridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

interface PermissionState {
  kind: 'permission'
  request: PermissionRequest
  selection: 'allow' | 'deny'
}

interface TranscriptState {
  kind: 'transcript'
  sessionId: string
  transcriptId: string
  text: string
  selection: 'send' | 'retry'
}

type RecoverableState = { kind: 'idle' } | PermissionState | TranscriptState

type AppState =
  | { kind: 'booting' }
  | { kind: 'connecting' }
  | { kind: 'disconnected' }
  | { kind: 'idle' }
  | PermissionState
  | { kind: 'starting-recording'; sessionId: string }
  | { kind: 'recording'; sessionId: string }
  | { kind: 'transcribing'; sessionId: string }
  | TranscriptState
  | {
      kind: 'busy'
      action: 'permission' | 'voice.send' | 'voice.retry'
      requestId: string
      recover: RecoverableState
    }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string; recover: RecoverableState }

let state: AppState = { kind: 'booting' }
let hub: HubBridge | null = null
let remote: RemoteClient | null = null
let unsubscribeHub = () => {}
let permissionQueue: PermissionRequest[] = []
let successTimer: number | null = null
let cleanedUp = false

mountUi({
  onPrimary: () => {
    void handleWebPrimary().catch(error => showError(errorMessage(error), recoverableState()))
  },
  onSecondary: () => {
    void handleWebSecondary().catch(error => showError(errorMessage(error), recoverableState()))
  },
})
renderAll()

void start().catch(error => showError(errorMessage(error), { kind: 'idle' }))

async function start(): Promise<void> {
  hub = await waitForEvenAppBridge()
  const container = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 8,
    containerID: 1,
    containerName: 'remote',
    content: glassesTextFor(state),
    isEventCapture: 1,
  })
  const created = await hub.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [container] }),
  )
  if (created !== 0) throw new Error(`G2 startup page failed with code ${created}.`)

  unsubscribeHub = hub.onEvenHubEvent(event => {
    const pcm = event.audioEvent?.audioPcm
    if (pcm && state.kind === 'recording') {
      try {
        remote?.sendAudio(pcm)
      } catch (error) {
        const sessionId = state.sessionId
        state = { kind: 'error', message: errorMessage(error), recover: { kind: 'idle' } }
        void hub?.audioControl(false)
        trySend({ type: 'audio.cancel', sessionId })
        renderAll()
      }
    }

    const sysType = eventTypeOf(event.sysEvent)
    const textType = eventTypeOf(event.textEvent)
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void hub?.shutDownPageContainer(1)
      return
    }
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      toggleSelection()
      return
    }
    if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
      void handleGlassTap().catch(error => showError(errorMessage(error), recoverableState()))
      return
    }
    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      cleanup()
    }
  })

  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL?.trim()
  const bridgeToken = import.meta.env.VITE_BRIDGE_TOKEN?.trim()
  if (!bridgeUrl || !bridgeToken) {
    showError('VITE_BRIDGE_URL and VITE_BRIDGE_TOKEN must be configured.', { kind: 'idle' })
    return
  }

  state = { kind: 'connecting' }
  renderAll()
  remote = new RemoteClient({
    url: bridgeUrl,
    token: bridgeToken,
    clientId: loadClientId(),
    onStatus: handleRemoteStatus,
    onMessage: message => {
      void handleRemoteMessage(message).catch(error => showError(errorMessage(error), recoverableState()))
    },
    onProtocolError: message => showError(`Protocol error: ${message}`, recoverableState()),
  })
  remote.connect()
}

function handleRemoteStatus(connection: RemoteConnectionState): void {
  if (connection === 'connected') {
    state = { kind: 'connecting' }
  } else if (connection === 'disconnected') {
    clearSuccessTimer()
    state = { kind: 'disconnected' }
    void hub?.audioControl(false)
  } else if (state.kind === 'disconnected') {
    state = { kind: 'connecting' }
  }
  renderAll()
}

async function handleRemoteMessage(message: ServerMessage): Promise<void> {
  switch (message.type) {
    case 'server.hello':
      permissionQueue = dedupePermissions(message.pendingPermissions)
      showNextPermissionOrIdle()
      return
    case 'permission.request':
      enqueuePermission(message.request)
      return
    case 'audio.started':
      if (state.kind === 'starting-recording' && state.sessionId === message.sessionId) {
        await openMicrophone(message.sessionId)
      }
      return
    case 'transcription.started':
      if (
        (state.kind === 'transcribing' || state.kind === 'recording') &&
        state.sessionId === message.sessionId
      ) {
        state = { kind: 'transcribing', sessionId: message.sessionId }
        renderAll()
      }
      return
    case 'transcript.result':
      if (state.kind === 'transcribing' && state.sessionId === message.sessionId) {
        state = {
          kind: 'transcript',
          sessionId: message.sessionId,
          transcriptId: message.transcriptId,
          text: message.text,
          selection: 'send',
        }
        renderAll()
      }
      return
    case 'action.completed':
      handleActionCompleted(message.action, message.requestId, message.message)
      return
    case 'error':
      handleRemoteError(message.code, message.requestId, message.message)
      return
  }
}

async function openMicrophone(sessionId: string): Promise<void> {
  const opened = await hub?.audioControl(true)
  if (state.kind !== 'starting-recording' || state.sessionId !== sessionId) {
    if (opened) await hub?.audioControl(false)
    return
  }
  if (!opened) {
    trySend({ type: 'audio.cancel', sessionId })
    showError('G2 microphone could not be opened.', { kind: 'idle' })
    return
  }
  state = { kind: 'recording', sessionId }
  renderAll()
}

async function handleGlassTap(): Promise<void> {
  switch (state.kind) {
    case 'idle':
      startRecording()
      return
    case 'recording':
      await stopRecording(state.sessionId)
      return
    case 'permission':
      respondToPermission(state.selection)
      return
    case 'transcript':
      actOnTranscript(state.selection)
      return
    case 'error':
      restoreFromError(state.recover)
      return
    default:
      return
  }
}

async function handleWebPrimary(): Promise<void> {
  if (state.kind === 'permission') {
    respondToPermission('allow')
    return
  }
  if (state.kind === 'transcript') {
    actOnTranscript('send')
    return
  }
  await handleGlassTap()
}

async function handleWebSecondary(): Promise<void> {
  if (state.kind === 'permission') {
    respondToPermission('deny')
    return
  }
  if (state.kind === 'transcript') {
    actOnTranscript('retry')
    return
  }
  if (state.kind === 'error') {
    restoreFromError(state.recover)
  }
}

function startRecording(): void {
  if (!remote?.connected) {
    showError('Bridge is not connected.', { kind: 'idle' })
    return
  }
  const sessionId = createId()
  state = { kind: 'starting-recording', sessionId }
  renderAll()
  try {
    remote.send({ type: 'audio.start', sessionId })
  } catch (error) {
    showError(errorMessage(error), { kind: 'idle' })
  }
}

async function stopRecording(sessionId: string): Promise<void> {
  state = { kind: 'transcribing', sessionId }
  renderAll()
  const closed = await hub?.audioControl(false)
  if (!closed) {
    trySend({ type: 'audio.cancel', sessionId })
    showError('G2 microphone could not be closed cleanly.', { kind: 'idle' })
    return
  }
  try {
    remote?.send({ type: 'audio.stop', sessionId })
  } catch (error) {
    showError(errorMessage(error), { kind: 'idle' })
  }
}

function respondToPermission(decision: 'allow' | 'deny'): void {
  if (state.kind !== 'permission') return
  const recover = state
  state = { kind: 'busy', action: 'permission', requestId: state.request.id, recover }
  renderAll()
  try {
    remote?.send({ type: 'permission.response', requestId: recover.request.id, decision })
  } catch (error) {
    showError(errorMessage(error), recover)
  }
}

function actOnTranscript(action: 'send' | 'retry'): void {
  if (state.kind !== 'transcript') return
  const recover = state
  state = {
    kind: 'busy',
    action: action === 'send' ? 'voice.send' : 'voice.retry',
    requestId: state.transcriptId,
    recover,
  }
  renderAll()
  try {
    remote?.send({ type: 'transcript.action', transcriptId: recover.transcriptId, action })
  } catch (error) {
    showError(errorMessage(error), recover)
  }
}

function handleActionCompleted(
  action: 'permission' | 'voice.send' | 'voice.retry',
  requestId: string,
  message: string,
): void {
  permissionQueue = permissionQueue.filter(request => request.id !== requestId)
  if (action === 'permission' && state.kind === 'permission' && state.request.id === requestId) {
    showSuccess(message)
    return
  }
  if (
    action === 'permission' &&
    state.kind === 'error' &&
    state.recover.kind === 'permission' &&
    state.recover.request.id === requestId
  ) {
    showSuccess(message)
    return
  }
  if (state.kind !== 'busy' || state.action !== action || state.requestId !== requestId) return
  if (action === 'voice.retry') {
    state = { kind: 'idle' }
    startRecording()
    return
  }
  showSuccess(message)
}

function handleRemoteError(code: string, requestId: string | undefined, message: string): void {
  if (code === 'permission_not_found' || code === 'transcript_not_found') {
    if (requestId) permissionQueue = permissionQueue.filter(request => request.id !== requestId)
    showError(message, { kind: 'idle' })
    return
  }
  if (state.kind === 'busy' && (!requestId || requestId === state.requestId)) {
    showError(message, state.recover)
    return
  }
  if (
    (state.kind === 'starting-recording' || state.kind === 'recording' || state.kind === 'transcribing') &&
    (!requestId || requestId === state.sessionId)
  ) {
    void hub?.audioControl(false)
    showError(message, { kind: 'idle' })
    return
  }
  showError(message, recoverableState())
}

function enqueuePermission(request: PermissionRequest): void {
  if (state.kind === 'permission' && state.request.id === request.id) return
  if (state.kind === 'busy' && state.action === 'permission' && state.requestId === request.id) return
  if (permissionQueue.some(item => item.id === request.id)) return

  if (state.kind === 'idle' || state.kind === 'success') {
    clearSuccessTimer()
    state = { kind: 'permission', request, selection: 'deny' }
    renderAll()
  } else {
    permissionQueue.push(request)
  }
}

function showNextPermissionOrIdle(): void {
  clearSuccessTimer()
  const next = permissionQueue.shift()
  state = next ? { kind: 'permission', request: next, selection: 'deny' } : { kind: 'idle' }
  renderAll()
}

function showSuccess(message: string): void {
  clearSuccessTimer()
  state = { kind: 'success', message }
  renderAll()
  successTimer = window.setTimeout(showNextPermissionOrIdle, 1_000)
}

function showError(message: string, recover: RecoverableState): void {
  clearSuccessTimer()
  state = { kind: 'error', message, recover }
  renderAll()
}

function recoverableState(): RecoverableState {
  if (state.kind === 'permission' || state.kind === 'transcript' || state.kind === 'idle') return state
  if (state.kind === 'busy') return state.recover
  return { kind: 'idle' }
}

function restoreFromError(recover: RecoverableState): void {
  if (recover.kind === 'idle') showNextPermissionOrIdle()
  else {
    state = recover
    renderAll()
  }
}

function toggleSelection(): void {
  if (state.kind === 'permission') {
    state = { ...state, selection: state.selection === 'allow' ? 'deny' : 'allow' }
    renderAll()
  } else if (state.kind === 'transcript') {
    state = { ...state, selection: state.selection === 'send' ? 'retry' : 'send' }
    renderAll()
  }
}

function renderAll(): void {
  renderUi(uiViewFor(state))
  scheduleGlassesRender(glassesTextFor(state))
}

function uiViewFor(current: AppState): UiView {
  switch (current.kind) {
    case 'booting':
      return view('BOOTING', 'neutral', 'EVEN HUB', 'G2 を初期化中', 'SDK bridge の準備を待っています。', '')
    case 'connecting':
      return view('LINKING', 'neutral', 'LOCAL LINK', 'Mac Bridge に接続中', 'WebSocket セッションを同期しています。', '自動的に再接続します')
    case 'disconnected':
      return view('OFFLINE', 'danger', 'LOCAL LINK', 'Bridge がオフラインです', 'Mac の Bridge と同じ LAN にいるか確認してください。', '再接続を試行中')
    case 'idle':
      return view('READY', 'live', 'VOICE CHANNEL', '指示を録音できます', 'G2 のテンプルをタップするか、下のボタンから録音を開始します。', 'ダブルタップで終了', '録音開始')
    case 'permission':
      return view(
        'ACTION',
        'warning',
        'PERMISSION REQUEST',
        current.request.toolName,
        current.request.summary,
        `G2 選択: ${current.selection.toUpperCase()} · スワイプで切替`,
        'Allow',
        'Deny',
      )
    case 'starting-recording':
      return view('ARMING', 'neutral', 'VOICE CHANNEL', 'マイクを準備中', 'Bridge が録音セッションを確立しています。', '')
    case 'recording':
      return view('REC', 'live', 'VOICE CHANNEL', '録音しています', 'G2 に向かって指示を話してください。', 'タップで停止', '録音停止')
    case 'transcribing':
      return view('WORKING', 'neutral', 'LOCAL WHISPER', '文字起こし中', 'Mac 上の whisper.cpp で音声を処理しています。', '結果を確認してから送信します')
    case 'transcript':
      return view(
        'REVIEW',
        'warning',
        'TRANSCRIPT',
        '送信前に確認',
        current.text,
        `G2 選択: ${current.selection.toUpperCase()} · スワイプで切替`,
        'cmux へ送信',
        '取り直す',
      )
    case 'busy':
      return view('SENDING', 'neutral', 'LOCAL CONTROL', '操作を送信中', 'cmux の応答を待っています。', '')
    case 'success':
      return view('DONE', 'success', 'LOCAL CONTROL', '操作を完了しました', current.message, '')
    case 'error':
      return view('ERROR', 'danger', 'SYSTEM', '操作を完了できませんでした', current.message, 'タップして戻る', '戻る')
  }
}

function view(
  signal: string,
  tone: UiView['tone'],
  eyebrow: string,
  title: string,
  body: string,
  hint: string,
  primary?: string,
  secondary?: string,
): UiView {
  return { signal, tone, eyebrow, title, body, hint, primary, secondary }
}

function glassesTextFor(current: AppState): string {
  switch (current.kind) {
    case 'booting':
      return 'G2 REMOTE\n\nStarting...'
    case 'connecting':
      return 'G2 REMOTE\n\nConnecting to Mac...'
    case 'disconnected':
      return 'G2 REMOTE / OFFLINE\n\nReconnecting to Mac...'
    case 'idle':
      return 'G2 REMOTE / READY\n\nTap to record a voice command.\n\nDouble-tap to exit.'
    case 'permission': {
      const choices = current.selection === 'allow' ? '[ALLOW]   DENY' : ' ALLOW   [DENY]'
      return `PERMISSION REQUIRED\n\n${clip(current.request.toolName, 80)}\n${clip(current.request.summary, 300)}\n\n${choices}\nSwipe: select / Tap: confirm`
    }
    case 'starting-recording':
      return 'VOICE COMMAND\n\nOpening microphone...'
    case 'recording':
      return 'VOICE COMMAND / REC\n\nSpeak now.\n\nTap to stop.'
    case 'transcribing':
      return 'LOCAL WHISPER\n\nTranscribing...\n\nYou will review before send.'
    case 'transcript': {
      const choices = current.selection === 'send' ? '[SEND]   RETRY' : ' SEND   [RETRY]'
      return `REVIEW TRANSCRIPT\n\n${clip(current.text, 360)}\n\n${choices}\nSwipe: select / Tap: confirm`
    }
    case 'busy':
      return 'G2 REMOTE\n\nSending to cmux...'
    case 'success':
      return `DONE\n\n${clip(current.message, 320)}`
    case 'error':
      return `ERROR\n\n${clip(current.message, 360)}\n\nTap to go back.`
  }
}

let pendingGlassesText: string | null = null
let lastGlassesText = ''
let glassesRenderTimer: number | null = null
let glassesWrite = Promise.resolve()

function scheduleGlassesRender(content: string): void {
  pendingGlassesText = content
  if (!hub || glassesRenderTimer !== null) return
  glassesRenderTimer = window.setTimeout(() => {
    glassesRenderTimer = null
    const next = pendingGlassesText
    pendingGlassesText = null
    if (!next || next === lastGlassesText || !hub) return
    glassesWrite = glassesWrite
      .then(async () => {
        if (!hub) return
        const updated = await hub.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: 1, containerName: 'remote', content: next }),
        )
        if (updated) lastGlassesText = next
        else console.warn('textContainerUpgrade returned false.')
      })
      .catch(error => console.error('Failed to render G2 text:', error))
  }, 120)
}

function trySend(message: Parameters<RemoteClient['send']>[0]): void {
  try {
    remote?.send(message)
  } catch {
    // This path is cleanup-only; connection state already explains the failure.
  }
}

function dedupePermissions(requests: PermissionRequest[]): PermissionRequest[] {
  return requests.filter((request, index) => requests.findIndex(candidate => candidate.id === request.id) === index)
}

function clip(value: string, maxLength: number): string {
  const safe = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').trim()
  return safe.length <= maxLength ? safe : `${safe.slice(0, maxLength - 1)}…`
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function loadClientId(): string {
  const key = 'eveng2-remote-client-id'
  try {
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    const created = createId()
    window.localStorage.setItem(key, created)
    return created
  } catch {
    return createId()
  }
}

function clearSuccessTimer(): void {
  if (successTimer !== null) window.clearTimeout(successTimer)
  successTimer = null
}

function cleanup(): void {
  if (cleanedUp) return
  cleanedUp = true
  clearSuccessTimer()
  if (glassesRenderTimer !== null) window.clearTimeout(glassesRenderTimer)
  void hub?.audioControl(false)
  remote?.close()
  unsubscribeHub()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

window.addEventListener('beforeunload', cleanup)
