#!/usr/bin/env node

const bridgeUrl = process.env.EVENG2_BRIDGE_URL || 'http://127.0.0.1:8787'
const token = process.env.EVENG2_BRIDGE_HOOK_TOKEN

if (!token) {
  console.error('EVENG2_BRIDGE_HOOK_TOKEN is required; falling back to the local permission dialog.')
  process.exit(0)
}

const chunks = []
let inputBytes = 0
for await (const chunk of process.stdin) {
  inputBytes += chunk.byteLength
  if (inputBytes > 1024 * 1024) {
    console.error('Claude hook input exceeded 1 MiB; falling back to the local permission dialog.')
    process.exit(0)
  }
  chunks.push(chunk)
}

let hook
try {
  hook = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch {
  console.error('Claude hook input was not valid JSON.')
  process.exit(0)
}

const body = {
  ...hook,
  source: 'claude',
  surfaceId: process.env.CMUX_SURFACE_ID,
  workspaceId: process.env.CMUX_WORKSPACE_ID,
}

try {
  const response = await fetch(new URL('/hooks/permission', bridgeUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(70_000),
  })
  if (!response.ok) {
    console.error(`Bridge returned HTTP ${response.status}: ${await response.text()}`)
    process.exit(0)
  }
  const result = await response.json()
  if (result?.decision !== 'allow' && result?.decision !== 'deny') {
    console.error('Bridge returned an invalid permission decision; falling back to the local permission dialog.')
    process.exit(0)
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision:
          result.decision === 'allow'
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: 'Permission denied from Even G2.' },
      },
    }),
  )
} catch (error) {
  console.error(`Failed to notify the Even G2 bridge: ${error instanceof Error ? error.message : error}`)
  process.exit(0)
}
