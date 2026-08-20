import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

const SCRIPT_PATH = new URL('../scripts/post-permission-hook.mjs', import.meta.url)

test('returns a structured PermissionRequest decision to Claude Code', async t => {
  const hookToken = 'hook-token-that-is-longer-than-32-characters'
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${hookToken}`)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    assert.equal(body.tool_name, 'Bash')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ decision: 'deny', requestId: 'request-1' }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))))

  const address = server.address() as AddressInfo
  const result = await runHook(
    JSON.stringify({ request_id: 'request-1', tool_name: 'Bash', tool_input: { command: 'npm test' } }),
    {
      EVENG2_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
      EVENG2_BRIDGE_HOOK_TOKEN: hookToken,
    },
  )

  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Permission denied from Even G2.' },
    },
  })
})

async function runHook(
  input: string,
  environment: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [SCRIPT_PATH.pathname], {
    env: { PATH: process.env.PATH, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.end(input)
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  return { code, stdout, stderr }
}
