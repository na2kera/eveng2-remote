import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

const CONFIG_KEYS = [
  'BRIDGE_HOST',
  'BRIDGE_CLIENT_TOKEN',
  'BRIDGE_HOOK_TOKEN',
  'BRIDGE_TLS_CERT_PATH',
  'BRIDGE_TLS_KEY_PATH',
] as const

test('uses loopback by default and requires separate client and hook tokens', () => {
  withConfigEnvironment(() => {
    process.env.BRIDGE_CLIENT_TOKEN = 'client-token-that-is-longer-than-32-characters'
    process.env.BRIDGE_HOOK_TOKEN = 'hook-token-that-is-different-and-longer-than-32-characters'
    const config = loadConfig()
    assert.equal(config.host, '127.0.0.1')
    assert.notEqual(config.clientToken, config.hookToken)
  })
})

test('rejects a shared token and non-loopback plaintext binding', () => {
  withConfigEnvironment(() => {
    const token = 'shared-token-that-is-longer-than-32-characters'
    process.env.BRIDGE_CLIENT_TOKEN = token
    process.env.BRIDGE_HOOK_TOKEN = token
    assert.throws(() => loadConfig(), /must differ/)

    process.env.BRIDGE_HOOK_TOKEN = 'different-hook-token-that-is-longer-than-32-characters'
    process.env.BRIDGE_HOST = '0.0.0.0'
    assert.throws(() => loadConfig(), /TLS certificate and key are required/)
  })
})

function withConfigEnvironment(run: () => void): void {
  const previous = new Map(CONFIG_KEYS.map(key => [key, process.env[key]]))
  for (const key of CONFIG_KEYS) delete process.env[key]
  try {
    run()
  } finally {
    for (const key of CONFIG_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
