export const GLASSES_PERMISSION_REVIEW_CHARS = 300
export const GLASSES_TRANSCRIPT_REVIEW_CHARS = 360

export function requiresCompanionReview(value: string, maxLength: number): boolean {
  return value.length > maxLength
}

export function parseBridgeUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('URL must use ws:// or wss://.')
  if (url.protocol === 'ws:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('Non-local Bridge connections must use wss://.')
  }
  return url
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
}
