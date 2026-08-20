import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CmuxTarget } from '@eveng2-remote/protocol'

const execFileAsync = promisify(execFile)

export interface CmuxOptions {
  binary: string
  defaultSurface?: string
  defaultWorkspace?: string
}

export interface CmuxController {
  sendText(target: CmuxTarget, text: string): Promise<void>
  resolveTarget(target?: CmuxTarget): CmuxTarget
}

export type CmuxCommandRunner = (binary: string, args: string[]) => Promise<void>

export class CmuxClient implements CmuxController {
  private sendQueue = Promise.resolve()

  constructor(
    private readonly options: CmuxOptions,
    private readonly run: CmuxCommandRunner = runCmux,
  ) {}

  resolveTarget(target: CmuxTarget = {}): CmuxTarget {
    const resolved: CmuxTarget = {
      surfaceId: target.surfaceId || this.options.defaultSurface,
      workspaceId: target.workspaceId || this.options.defaultWorkspace,
    }
    if (!resolved.surfaceId && !resolved.workspaceId) {
      throw new Error('No cmux target is known. Include surfaceId in the hook or set CMUX_DEFAULT_SURFACE.')
    }
    return resolved
  }

  async sendText(target: CmuxTarget, text: string): Promise<void> {
    const operation = this.sendQueue.then(() => this.pasteAndSubmit(target, text))
    this.sendQueue = operation.catch(() => undefined)
    await operation
  }

  private async pasteAndSubmit(target: CmuxTarget, text: string): Promise<void> {
    const args = targetArgs(this.resolveTarget(target))
    const bufferName = '__eveng2_remote_voice__'
    let bufferWasSet = false
    try {
      await this.run(this.options.binary, ['set-buffer', '--name', bufferName, '--', text])
      bufferWasSet = true
      await this.run(this.options.binary, ['paste-buffer', '--name', bufferName, ...args])
      await this.run(this.options.binary, ['send-key', ...args, 'Enter'])
    } finally {
      if (bufferWasSet) {
        try {
          await this.run(this.options.binary, ['set-buffer', '--name', bufferName, '--', '[cleared]'])
        } catch {
          // Do not report a successful terminal submission as failed and invite a duplicate retry.
        }
      }
    }
  }
}

function targetArgs(target: CmuxTarget): string[] {
  if (target.surfaceId) return ['--surface', target.surfaceId]
  if (target.workspaceId) return ['--workspace', target.workspaceId]
  throw new Error('A cmux surface or workspace is required.')
}

async function runCmux(binary: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(binary, args, { timeout: 10_000, maxBuffer: 1024 * 1024 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`cmux command failed: ${detail}`)
  }
}
