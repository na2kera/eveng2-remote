import assert from 'node:assert/strict'
import test from 'node:test'
import { CmuxClient, type CmuxCommandRunner } from '../src/cmux.js'

test('pastes exact text through a dedicated buffer and clears it after submitting', async () => {
  const calls: Array<{ binary: string; args: string[] }> = []
  const runner: CmuxCommandRunner = async (binary, args) => {
    calls.push({ binary, args })
  }
  const cmux = new CmuxClient(
    { binary: '/bin/cmux', defaultSurface: 'surface:1' },
    runner,
  )

  await cmux.sendText({}, 'run $(touch /tmp/should-not-execute)')

  assert.deepEqual(calls, [
    {
      binary: '/bin/cmux',
      args: [
        'set-buffer',
        '--name',
        '__eveng2_remote_voice__',
        '--',
        'run $(touch /tmp/should-not-execute)',
      ],
    },
    {
      binary: '/bin/cmux',
      args: ['paste-buffer', '--name', '__eveng2_remote_voice__', '--surface', 'surface:1'],
    },
    { binary: '/bin/cmux', args: ['send-key', '--surface', 'surface:1', 'Enter'] },
    {
      binary: '/bin/cmux',
      args: ['set-buffer', '--name', '__eveng2_remote_voice__', '--', '[cleared]'],
    },
  ])
})

test('clears the dedicated buffer even when Enter fails', async () => {
  const calls: string[][] = []
  const cmux = new CmuxClient(
    { binary: 'cmux', defaultSurface: 'surface:1' },
    async (_binary, args) => {
      calls.push(args)
      if (args[0] === 'send-key') throw new Error('socket closed')
    },
  )

  await assert.rejects(() => cmux.sendText({}, 'hello'), /socket closed/)
  assert.deepEqual(calls.at(-1), [
    'set-buffer',
    '--name',
    '__eveng2_remote_voice__',
    '--',
    '[cleared]',
  ])
})
