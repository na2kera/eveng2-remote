#!/usr/bin/env node

const bridgeUrl = process.env.EVENG2_BRIDGE_URL || 'http://127.0.0.1:8787'
const token = process.env.EVENG2_BRIDGE_TOKEN

if (!token) {
  console.error('EVENG2_BRIDGE_TOKEN is required.')
  process.exit(1)
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let hook
try {
  hook = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch {
  console.error('Claude hook input was not valid JSON.')
  process.exit(1)
}

const body = {
  ...hook,
  source: hook.source || 'claude',
  surfaceId: hook.surfaceId || process.env.CMUX_SURFACE_ID,
  workspaceId: hook.workspaceId || process.env.CMUX_WORKSPACE_ID,
}

try {
  const response = await fetch(new URL('/hooks/permission', bridgeUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    console.error(`Bridge returned HTTP ${response.status}: ${await response.text()}`)
    process.exit(1)
  }
} catch (error) {
  console.error(`Failed to notify the Even G2 bridge: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
