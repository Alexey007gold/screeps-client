import type { AuthStrategy } from './AuthStrategy.js'
import type { HttpClient } from '../HttpClient.js'

/**
 * Guest authentication strategy for xxscreeps-compatible private servers.
 * Bypasses HTTP sign-in and sends the literal token "guest" to the WebSocket,
 * granting read-only observer access without an account.
 */
export class GuestAuth implements AuthStrategy {
  async authenticate(_http: HttpClient): Promise<string> {
    return 'guest'
  }
}
