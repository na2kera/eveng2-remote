import { randomUUID } from 'node:crypto'
import type { CmuxTarget, PermissionRequest } from '@eveng2-remote/protocol'

interface UnknownRecord {
  [key: string]: unknown
}

export function normalizePermissionHook(value: unknown, now = new Date()): PermissionRequest {
  if (!isRecord(value)) throw new Error('Hook body must be a JSON object.')

  const payload = recordAt(value, 'payload')
  const notification = recordAt(value, 'notification')
  const toolInput = firstDefined(value.toolInput, value.tool_input, payload?.tool_input)
  const sessionId = stringAt(firstDefined(value.sessionId, value.session_id, payload?.session_id), 160)
  const toolUseId = stringAt(firstDefined(value.toolUseId, value.tool_use_id, payload?.tool_use_id), 160)
  const suppliedId = stringAt(firstDefined(value.requestId, value.request_id, payload?.request_id), 160)
  const id = suppliedId || [sessionId, toolUseId].filter(Boolean).join(':') || randomUUID()

  const target: CmuxTarget = compactTarget({
    surfaceId: stringAt(firstDefined(value.surfaceId, value.surface_id, payload?.surface_id), 160),
    workspaceId: stringAt(firstDefined(value.workspaceId, value.workspace_id, payload?.workspace_id), 160),
  })

  const source =
    stringAt(firstDefined(value.source, value.agent, payload?._source, payload?.source), 80) || 'claude'
  const toolName =
    stringAt(firstDefined(value.toolName, value.tool_name, payload?.tool_name, notification?.title), 160) ||
    'Permission request'
  const explicitSummary = stringAt(
    firstDefined(value.summary, value.message, value.body, notification?.body),
    2_000,
  )
  const summary = explicitSummary || summarizeToolInput(toolInput)

  return { id, source, toolName, summary, target, createdAt: now.toISOString() }
}

function summarizeToolInput(value: unknown): string {
  if (typeof value === 'string') return truncate(value, 2_000)
  if (value === undefined || value === null) return 'Approval requested.'
  try {
    return truncate(JSON.stringify(value), 2_000)
  } catch {
    return 'Approval requested.'
  }
}

function compactTarget(target: CmuxTarget): CmuxTarget {
  const result: CmuxTarget = {}
  if (target.surfaceId) result.surfaceId = target.surfaceId
  if (target.workspaceId) result.workspaceId = target.workspaceId
  return result
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: UnknownRecord, key: string): UnknownRecord | undefined {
  const nested = value[key]
  return isRecord(nested) ? nested : undefined
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null)
}

function stringAt(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? truncate(trimmed, maxLength) : undefined
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}
