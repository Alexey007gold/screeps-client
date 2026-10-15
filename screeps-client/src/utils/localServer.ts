import { fromProxyUrl } from './proxy.js'

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/

export function isLocalServerUrl(url: string | null): boolean {
  if (!url) return false
  let hostname: string
  try {
    hostname = new URL(fromProxyUrl(url)).hostname
  } catch {
    return false
  }
  return hostname.includes('localhost') || IPV4_HOST.test(hostname) || hostname.startsWith('[')
}
