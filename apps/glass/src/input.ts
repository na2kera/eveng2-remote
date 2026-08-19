import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

/** CLICK_EVENT is protobuf zero and is omitted inside an existing event envelope. */
export function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}
