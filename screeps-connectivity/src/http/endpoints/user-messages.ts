import type { HttpClient } from '../HttpClient.js'
import type { ApiUserMessagesListResponse, ApiUserMessagesIndexResponse, ApiUserMessagesUnreadCountResponse } from '../../types/api.js'

export interface UserMessagesEndpoints {
  send(respondent: string, text: string): Promise<{ ok: number }>
  list(respondent: string): Promise<ApiUserMessagesListResponse>
  index(): Promise<ApiUserMessagesIndexResponse>
  markRead(id: string): Promise<{ ok: number }>
  unreadCount(): Promise<ApiUserMessagesUnreadCountResponse>
}

export function createUserMessagesEndpoints(http: HttpClient): UserMessagesEndpoints {
  return {
    send: (respondent, text) => http.request('POST', '/api/user/messages/send', { respondent, text }),
    list: (respondent) => http.request('GET', '/api/user/messages/list', { respondent }),
    index: () => http.request('GET', '/api/user/messages/index'),
    markRead: (id) => http.request('POST', '/api/user/messages/mark-read', { id }),
    unreadCount: () => http.request('GET', '/api/user/messages/unread-count'),
  }
}
