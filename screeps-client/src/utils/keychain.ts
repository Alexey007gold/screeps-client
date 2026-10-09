import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './tauri.js'
import { isProxy } from './proxy.js'
import { createLogger } from './log.js'

const { log } = createLogger('keychain')
const SERVICE = 'screeps-desktop'

// Browser proxy mode has no OS keychain, so saved credentials fall back to
// localStorage (private to the proxy's origin). See screeps-client-proxy/README
// for the security note. Namespaced so it never collides with other keys.
const LS_PREFIX = 'screeps:keychain:'
const lsKey = (account: string) => `${LS_PREFIX}${account}`

async function keychainSave(account: string, secret: string): Promise<void> {
  log(`save  [${account}]`)
  try {
    await invoke('keyring_set', { service: SERVICE, account, secret })
    log(`save  [${account}] ✓`)
  } catch (e) {
    log(`save  [${account}] ✗`, e)
    throw e
  }
}

async function keychainLoad(account: string): Promise<string | null> {
  log(`load  [${account}]`)
  try {
    const result = await invoke<string | null>('keyring_get', { service: SERVICE, account })
    log(`load  [${account}] →`, result !== null ? '[found]' : '[not found]')
    return result
  } catch (e) {
    log(`load  [${account}] ✗`, e)
    throw e
  }
}

async function keychainDelete(account: string): Promise<void> {
  log(`delete [${account}]`)
  try {
    await invoke('keyring_delete', { service: SERVICE, account })
    log(`delete [${account}] ✓`)
  } catch (e) {
    log(`delete [${account}] ✗`, e)
    throw e
  }
}

export type SavedCredentialType = 'password' | 'token'

const tokenAccount = (url: string) => `${url}:token`
const serverPasswordAccount = (url: string) => `${url}:serverPassword`
const savedCredentialAccount = (url: string, type: SavedCredentialType) => `${url}:savedCredential:${type}`
const savedUsernameAccount = (url: string) => `${url}:savedCredential:username`

// Dispatch: OS keychain under Tauri, localStorage under the browser proxy, no-op
// otherwise (plain browser without a secure store).
async function secretSave(account: string, secret: string): Promise<void> {
  if (isTauri()) return keychainSave(account, secret)
  if (isProxy()) { localStorage.setItem(lsKey(account), secret); return }
}

async function secretLoad(account: string): Promise<string | null> {
  if (isTauri()) return keychainLoad(account)
  if (isProxy()) return localStorage.getItem(lsKey(account))
  return null
}

async function secretDelete(account: string): Promise<void> {
  if (isTauri()) return keychainDelete(account)
  if (isProxy()) { localStorage.removeItem(lsKey(account)); return }
}

export async function saveTokenForUrl(url: string, token: string): Promise<void> {
  await secretSave(tokenAccount(url), token)
}

export async function loadTokenForUrl(url: string): Promise<string | null> {
  return secretLoad(tokenAccount(url))
}

export async function deleteTokenForUrl(url: string): Promise<void> {
  await secretDelete(tokenAccount(url))
}

export async function saveServerPasswordForUrl(url: string, password: string): Promise<void> {
  await secretSave(serverPasswordAccount(url), password)
}

export async function loadServerPasswordForUrl(url: string): Promise<string | null> {
  return secretLoad(serverPasswordAccount(url))
}

export async function deleteServerPasswordForUrl(url: string): Promise<void> {
  await secretDelete(serverPasswordAccount(url))
}

export async function saveSavedCredential(url: string, type: SavedCredentialType, credential: string): Promise<void> {
  await secretSave(savedCredentialAccount(url, type), credential)
}

export async function loadSavedCredential(url: string, type: SavedCredentialType): Promise<string | null> {
  return secretLoad(savedCredentialAccount(url, type))
}

export async function deleteSavedCredential(url: string, type: SavedCredentialType): Promise<void> {
  await secretDelete(savedCredentialAccount(url, type))
}

export async function saveSavedUsername(url: string, username: string): Promise<void> {
  await secretSave(savedUsernameAccount(url), username)
}

export async function loadSavedUsername(url: string): Promise<string | null> {
  return secretLoad(savedUsernameAccount(url))
}

export async function deleteSavedUsername(url: string): Promise<void> {
  await secretDelete(savedUsernameAccount(url))
}
