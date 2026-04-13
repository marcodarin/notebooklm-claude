import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { logger } from '../lib/logger.js'
import { NOTEBOOKLM_HOME } from '../adapter/rpc-constants.js'

export interface AuthTokens {
  cookies: Record<string, string>
  csrfToken: string
  sessionId: string
}

export interface SessionStatus {
  initialized: boolean
  lastTokenRefresh: number | null
  tokenAge: number | null
  cookieExpiry: number | null
  nextRefresh: number | null
  refreshCount: number
}

const CSRF_REGEX = /"SNlM0e"\s*:\s*"([^"]+)"/
const SESSION_ID_REGEX = /"FdrFJe"\s*:\s*"([^"]+)"/

export function buildCookieHeader (cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

export function extractCookiesFromStorage (storageState: { cookies?: Array<{ domain?: string; name?: string; value?: string }> }): Record<string, string> {
  const allowedDomains = new Set(['.google.com', 'notebooklm.google.com', '.googleusercontent.com'])
  const cookies: Record<string, string> = {}

  for (const cookie of storageState.cookies || []) {
    const domain = cookie.domain || ''
    if (allowedDomains.has(domain) && cookie.name) {
      cookies[cookie.name] = cookie.value || ''
    }
  }

  if (!cookies.SID) {
    throw new Error('Missing required SID cookie. Run notebooklm login to authenticate.')
  }

  return cookies
}

export async function fetchTokens (cookies: Record<string, string>): Promise<{ csrfToken: string; sessionId: string }> {
  const cookieHeader = buildCookieHeader(cookies)

  const response = await fetch(NOTEBOOKLM_HOME, {
    headers: { Cookie: cookieHeader },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch NotebookLM homepage: ${response.status} ${response.statusText}`)
  }

  const finalUrl = response.url
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error('Authentication expired. Redirected to login page. Re-authenticate and update storage.')
  }

  const html = await response.text()

  const csrfMatch = html.match(CSRF_REGEX)
  if (!csrfMatch) {
    throw new Error('CSRF token (SNlM0e) not found in HTML. Page structure may have changed.')
  }

  const sessionMatch = html.match(SESSION_ID_REGEX)
  if (!sessionMatch) {
    throw new Error('Session ID (FdrFJe) not found in HTML. Page structure may have changed.')
  }

  return {
    csrfToken: csrfMatch[1],
    sessionId: sessionMatch[1],
  }
}

const TOKEN_REFRESH_INTERVAL_MS = 25 * 60 * 1000

export class SessionManager {
  private auth: AuthTokens | null = null
  private storagePath: string
  private tokenRefreshInterval: ReturnType<typeof setInterval> | null = null
  private pendingRefresh: Promise<void> | null = null
  private lastTokenRefreshTs: number | null = null
  private refreshCount = 0
  private rawStorageState: object | null = null

  constructor (storagePath?: string) {
    this.storagePath = storagePath || process.env.SESSION_STORE_PATH || '/tmp/notebooklm-session'
  }

  async initialize (): Promise<void> {
    const authJson = process.env.NOTEBOOKLM_AUTH_JSON
    let cookies: Record<string, string>

    if (authJson) {
      const storageState = JSON.parse(authJson)
      this.rawStorageState = storageState
      cookies = extractCookiesFromStorage(storageState)
    } else {
      const storagePath = `${this.storagePath}/storage_state.json`
      if (!existsSync(storagePath)) {
        throw new Error(
          `Storage file not found: ${storagePath}. ` +
          'Either set NOTEBOOKLM_AUTH_JSON env var with Playwright storage state JSON, ' +
          'or place storage_state.json at the configured path.'
        )
      }
      const raw = await readFile(storagePath, 'utf-8')
      const storageState = JSON.parse(raw)
      this.rawStorageState = storageState
      cookies = extractCookiesFromStorage(storageState)
    }

    const { csrfToken, sessionId } = await fetchTokens(cookies)
    this.auth = { cookies, csrfToken, sessionId }
    this.lastTokenRefreshTs = Date.now()
    this.refreshCount++
    logger.info('NotebookLM session initialized successfully')

    this.startKeepAlive()
  }

  /**
   * Deduplicated token refresh: concurrent callers share a single in-flight request.
   */
  async refreshTokens (): Promise<void> {
    if (!this.auth) throw new Error('Session not initialized')

    if (this.pendingRefresh) {
      return this.pendingRefresh
    }

    this.pendingRefresh = this.doRefreshTokens()
    try {
      await this.pendingRefresh
    } finally {
      this.pendingRefresh = null
    }
  }

  private async doRefreshTokens (): Promise<void> {
    if (!this.auth) throw new Error('Session not initialized')

    try {
      const { csrfToken, sessionId } = await fetchTokens(this.auth.cookies)
      this.auth.csrfToken = csrfToken
      this.auth.sessionId = sessionId
      this.lastTokenRefreshTs = Date.now()
      this.refreshCount++
      logger.info({ refreshCount: this.refreshCount }, 'Session tokens refreshed')
    } catch (err) {
      logger.error({ err }, 'Failed to refresh tokens')
      throw err
    }
  }

  /**
   * Update cookies at runtime (e.g. from admin endpoint) and re-fetch tokens.
   */
  async updateCookies (storageStateJson: string): Promise<void> {
    const storageState = JSON.parse(storageStateJson)
    const cookies = extractCookiesFromStorage(storageState)
    this.rawStorageState = storageState

    const { csrfToken, sessionId } = await fetchTokens(cookies)
    this.auth = { cookies, csrfToken, sessionId }
    this.lastTokenRefreshTs = Date.now()
    this.refreshCount++

    this.stopKeepAlive()
    this.startKeepAlive()

    logger.info('Session cookies updated and tokens refreshed')
  }

  getAuth (): AuthTokens {
    if (!this.auth) {
      throw new Error('Session not initialized. Call initialize() first.')
    }
    return this.auth
  }

  isInitialized (): boolean {
    return this.auth !== null
  }

  getStatus (): SessionStatus {
    const now = Date.now()
    let cookieExpiry: number | null = null

    if (this.rawStorageState && typeof this.rawStorageState === 'object' && 'cookies' in this.rawStorageState) {
      const cookies = (this.rawStorageState as { cookies?: Array<{ name?: string; expires?: number }> }).cookies || []
      const sidCookie = cookies.find(c => c.name === 'SID')
      if (sidCookie?.expires) {
        cookieExpiry = Math.floor(sidCookie.expires * 1000)
      }
    }

    return {
      initialized: this.auth !== null,
      lastTokenRefresh: this.lastTokenRefreshTs,
      tokenAge: this.lastTokenRefreshTs ? Math.floor((now - this.lastTokenRefreshTs) / 1000) : null,
      cookieExpiry,
      nextRefresh: this.lastTokenRefreshTs
        ? this.lastTokenRefreshTs + TOKEN_REFRESH_INTERVAL_MS
        : null,
      refreshCount: this.refreshCount,
    }
  }

  async saveStorageState (storageState: object): Promise<void> {
    const dir = dirname(`${this.storagePath}/storage_state.json`)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(
      `${this.storagePath}/storage_state.json`,
      JSON.stringify(storageState, null, 2),
      'utf-8'
    )
    logger.info('Storage state saved')
  }

  private startKeepAlive (): void {
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        await this.refreshTokens()
      } catch (err) {
        logger.warn({ err }, 'Keep-alive token refresh failed — cookies may be expired')
      }
    }, TOKEN_REFRESH_INTERVAL_MS)

    if (this.tokenRefreshInterval.unref) {
      this.tokenRefreshInterval.unref()
    }
  }

  private stopKeepAlive (): void {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval)
      this.tokenRefreshInterval = null
    }
  }

  destroy (): void {
    this.stopKeepAlive()
    this.auth = null
  }
}
