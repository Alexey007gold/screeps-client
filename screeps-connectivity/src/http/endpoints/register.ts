import type { HttpClient } from '../HttpClient.js'
import type { ApiRegisterCheckResponse } from '../../types/api.js'

export interface RegisterEndpoints {
  checkEmail(email: string): Promise<ApiRegisterCheckResponse>
  checkUsername(username: string): Promise<ApiRegisterCheckResponse>
  setUsername(username: string, email?: string): Promise<{ ok: number }>
}

export function createRegisterEndpoints(http: HttpClient): RegisterEndpoints {
  return {
    checkEmail: (email) => http.request('GET', '/api/register/check-email', { email }),
    checkUsername: (username) => http.request('GET', '/api/register/check-username', { username }),
    setUsername: (username, email) => http.request('POST', '/api/register/set-username', { username, ...(email != null ? { email } : {}) }),
  }
}
