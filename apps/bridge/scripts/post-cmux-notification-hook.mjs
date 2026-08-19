#!/usr/bin/env node

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const raw = Buffer.concat(chunks).toString('utf8')

let input
try {
  input = JSON.parse(raw)
} catch {
  console.error('cmux notification hook input was not valid JSON.')
  process.stdout.write(raw)
  process.exit(0)
}

const notification = input?.notification
const text = [notification?.title, notification?.subtitle, notification?.body]
  .filter(value => typeof value === 'string')
  .join(' ')

if (/needs? input|permission|approval|waiting/i.test(text)) {
  const bridgeUrl = process.env.EVENG2_BRIDGE_URL || 'http://127.0.0.1:8787'
  const token = process.env.EVENG2_BRIDGE_TOKEN
  if (!token) {
    console.error('EVENG2_BRIDGE_TOKEN is not set; skipped G2 forwarding.')
  } else {
    try {
      const response = await fetch(new URL('/hooks/cmux', bridgeUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'cmux',
          requestId: notification?.id,
          surfaceId: notification?.surfaceId,
          workspaceId: notification?.workspaceId,
          notification,
        }),
      })
      if (!response.ok) console.error(`G2 Bridge returned HTTP ${response.status}.`)
    } catch (error) {
      console.error(`Failed to notify G2 Bridge: ${error instanceof Error ? error.message : error}`)
    }
  }
}

process.stdout.write(JSON.stringify(input))
