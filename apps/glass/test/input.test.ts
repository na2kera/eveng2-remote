import assert from 'node:assert/strict'
import test from 'node:test'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { eventTypeOf } from '../src/input.js'

test('treats an omitted event type inside an envelope as a single tap', () => {
  assert.equal(eventTypeOf({}), OsEventTypeList.CLICK_EVENT)
})

test('does not treat a missing envelope as a tap', () => {
  assert.equal(eventTypeOf(undefined), null)
})

test('preserves explicit event types', () => {
  assert.equal(
    eventTypeOf({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }),
    OsEventTypeList.DOUBLE_CLICK_EVENT,
  )
})
