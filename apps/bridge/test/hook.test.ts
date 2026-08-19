import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePermissionHook } from '../src/hook.js'

test('normalizes Claude Code snake_case hook fields and cmux target', () => {
  const permission = normalizePermissionHook(
    {
      session_id: 'session-1',
      tool_use_id: 'tool-1',
      tool_name: 'Bash',
      tool_input: { command: 'npm install' },
      surface_id: 'surface:4',
      workspace_id: 'workspace:2',
    },
    new Date('2026-08-20T00:00:00.000Z'),
  )

  assert.deepEqual(permission, {
    id: 'session-1:tool-1',
    source: 'claude',
    toolName: 'Bash',
    summary: '{"command":"npm install"}',
    target: { surfaceId: 'surface:4', workspaceId: 'workspace:2' },
    createdAt: '2026-08-20T00:00:00.000Z',
  })
})

test('accepts cmux notification-shaped input', () => {
  const permission = normalizePermissionHook({
    source: 'codex',
    requestId: 'request-1',
    notification: { title: 'Codex', body: 'Agent needs input' },
  })

  assert.equal(permission.id, 'request-1')
  assert.equal(permission.toolName, 'Codex')
  assert.equal(permission.summary, 'Agent needs input')
})
