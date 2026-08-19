export type UiTone = 'neutral' | 'live' | 'warning' | 'danger' | 'success'

export interface UiView {
  signal: string
  tone: UiTone
  eyebrow: string
  title: string
  body: string
  hint: string
  primary?: string
  secondary?: string
}

export interface UiActions {
  onPrimary(): void
  onSecondary(): void
}

let signalEl: HTMLSpanElement
let eyebrowEl: HTMLParagraphElement
let titleEl: HTMLHeadingElement
let bodyEl: HTMLParagraphElement
let hintEl: HTMLParagraphElement
let primaryButton: HTMLButtonElement
let secondaryButton: HTMLButtonElement

export function mountUi(actions: UiActions): void {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) throw new Error('#app element was not found.')
  app.innerHTML = `
    <main class="shell">
      <div class="masthead">
        <div class="wordmark"><span class="wordmark-mark">G2</span><span>REMOTE</span></div>
        <span id="signal" class="signal" aria-live="polite">BOOTING</span>
      </div>
      <section class="console" aria-live="polite">
        <div class="scanline" aria-hidden="true"></div>
        <div class="index" aria-hidden="true">EV / 02</div>
        <p id="eyebrow" class="eyebrow">SYSTEM</p>
        <h1 id="title">Starting bridge link</h1>
        <p id="body" class="body">Waiting for the Even Hub runtime.</p>
        <p id="hint" class="hint"></p>
      </section>
      <div class="actions">
        <button id="primary" class="button button-primary" type="button"></button>
        <button id="secondary" class="button button-secondary" type="button"></button>
      </div>
      <footer><span>LOCAL CONTROL CHANNEL</span><span class="rule"></span><span>16 kHz PCM</span></footer>
    </main>
  `

  signalEl = requiredElement(app, '#signal')
  eyebrowEl = requiredElement(app, '#eyebrow')
  titleEl = requiredElement(app, '#title')
  bodyEl = requiredElement(app, '#body')
  hintEl = requiredElement(app, '#hint')
  primaryButton = requiredElement(app, '#primary')
  secondaryButton = requiredElement(app, '#secondary')
  primaryButton.addEventListener('click', actions.onPrimary)
  secondaryButton.addEventListener('click', actions.onSecondary)
  injectStyles()
}

export function renderUi(view: UiView): void {
  signalEl.textContent = view.signal
  signalEl.className = `signal signal-${view.tone}`
  eyebrowEl.textContent = view.eyebrow
  titleEl.textContent = view.title
  bodyEl.textContent = view.body
  hintEl.textContent = view.hint
  setButton(primaryButton, view.primary)
  setButton(secondaryButton, view.secondary)
}

function setButton(button: HTMLButtonElement, label: string | undefined): void {
  button.hidden = !label
  button.textContent = label ?? ''
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`${selector} element was not found.`)
  return element
}

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    :root {
      color-scheme: dark;
      --ink: #e9eee8;
      --muted: #849087;
      --line: #364039;
      --panel: #151b17;
      --ground: #0d110e;
      --signal: #80ff8a;
      --amber: #f6c95c;
      --red: #ff786f;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; background: var(--ground); color: var(--ink); }
    body {
      font-family: "Avenir Next", "Helvetica Neue", sans-serif;
      background:
        linear-gradient(rgba(128,255,138,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(128,255,138,.025) 1px, transparent 1px),
        radial-gradient(circle at 85% 5%, rgba(128,255,138,.08), transparent 32%),
        var(--ground);
      background-size: 28px 28px, 28px 28px, auto, auto;
    }
    button { font: inherit; }
    .shell {
      width: min(100%, 720px);
      min-height: 100%;
      margin: 0 auto;
      padding: max(24px, env(safe-area-inset-top)) 22px max(22px, env(safe-area-inset-bottom));
      display: grid;
      grid-template-rows: auto minmax(300px, 1fr) auto auto;
      gap: 18px;
    }
    .masthead, footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .wordmark { display: flex; align-items: center; gap: 10px; font: 700 12px/1 "SF Mono", Menlo, monospace; letter-spacing: .2em; }
    .wordmark-mark { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--signal); color: var(--signal); letter-spacing: 0; }
    .signal { padding: 7px 10px; border: 1px solid var(--line); color: var(--muted); font: 700 10px/1 "SF Mono", Menlo, monospace; letter-spacing: .12em; }
    .signal-live, .signal-success { color: var(--signal); border-color: rgba(128,255,138,.55); }
    .signal-warning { color: var(--amber); border-color: rgba(246,201,92,.55); }
    .signal-danger { color: var(--red); border-color: rgba(255,120,111,.55); }
    .console { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; min-height: 300px; padding: clamp(28px, 7vw, 58px); border: 1px solid var(--line); background: linear-gradient(145deg, rgba(255,255,255,.025), transparent 38%), var(--panel); box-shadow: inset 0 0 0 7px var(--ground), 0 24px 70px rgba(0,0,0,.28); }
    .console::before { content: ""; position: absolute; inset: 7px; border: 1px solid rgba(128,255,138,.08); pointer-events: none; }
    .scanline { position: absolute; left: 8px; right: 8px; height: 1px; top: 8px; background: linear-gradient(90deg, transparent, rgba(128,255,138,.5), transparent); animation: scan 6s linear infinite; opacity: .45; }
    .index { position: absolute; top: 30px; right: 30px; color: #536057; font: 600 10px/1 "SF Mono", Menlo, monospace; letter-spacing: .15em; }
    .eyebrow { margin: 0 0 18px; color: var(--signal); font: 700 11px/1 "SF Mono", Menlo, monospace; letter-spacing: .2em; }
    h1 { max-width: 610px; margin: 0; font: 500 clamp(30px, 8vw, 58px)/.98 "Iowan Old Style", "Palatino Linotype", serif; letter-spacing: -.04em; text-wrap: balance; }
    .body { max-width: 590px; min-height: 3em; margin: 22px 0 0; color: #b8c1ba; font: 500 16px/1.55 "SF Mono", Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .hint { margin: 28px 0 0; color: var(--muted); font: 600 11px/1.4 "SF Mono", Menlo, monospace; letter-spacing: .07em; text-transform: uppercase; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .button { min-height: 54px; border-radius: 0; border: 1px solid var(--line); font: 700 12px/1 "SF Mono", Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; transition: transform 120ms ease, background 120ms ease; }
    .button:active { transform: translateY(2px); }
    .button-primary { background: var(--signal); border-color: var(--signal); color: #081009; }
    .button-secondary { background: transparent; color: var(--ink); }
    .button[hidden] { display: none; }
    footer { color: #566159; font: 600 9px/1 "SF Mono", Menlo, monospace; letter-spacing: .12em; }
    footer .rule { height: 1px; flex: 1; background: var(--line); }
    @keyframes scan { from { transform: translateY(0); } to { transform: translateY(520px); } }
    @media (max-width: 460px) {
      .shell { padding-left: 14px; padding-right: 14px; gap: 12px; }
      .console { padding: 32px 26px; }
      .actions { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) { .scanline { animation: none; } }
  `
  document.head.appendChild(style)
}
