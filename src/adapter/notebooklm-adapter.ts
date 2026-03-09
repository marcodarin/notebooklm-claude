import { v4 as uuidv4 } from 'uuid'
import { logger } from '../lib/logger.js'
import { withRetry, CircuitBreaker } from '../lib/resilience.js'
import { SessionManager, buildCookieHeader } from '../session/session-manager.js'
import { RPCMethod, QUERY_URL } from './rpc-constants.js'
import { encodeRpcRequest, buildRequestBody, buildBatchUrl } from './rpc-encoder.js'
import { decodeResponse, parseAskResponse, RPCError } from './rpc-decoder.js'
import type { RPCMethodId } from './rpc-constants.js'

export interface NotebookInfo {
  id: string
  title: string
  createdAt: string | null
  isOwner: boolean
}

export interface NotebookMetadata {
  id: string
  title: string
  sourcesCount: number
  summary: string
  suggestedTopics: Array<{ question: string; prompt: string }>
}

export interface AskResult {
  answer: string
  conversationId: string
  turnNumber: number
}

export type AdapterErrorCode =
  | 'AUTH_EXPIRED'
  | 'NOTEBOOK_NOT_FOUND'
  | 'NOTEBOOK_ACCESS_DENIED'
  | 'NOTEBOOKLM_TIMEOUT'
  | 'RATE_LIMITED'
  | 'TEMPORARY_BROWSER_FAILURE'
  | 'UNKNOWN_UPSTREAM_ERROR'

export class AdapterError extends Error {
  code: AdapterErrorCode
  constructor (message: string, code: AdapterErrorCode) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
  }
}

const DEFAULT_TIMEOUT = 60_000
const ASK_TIMEOUT = 120_000
const DEFAULT_BL = 'boq_labs-tailwind-frontend_20260301.03_p0'

export class NotebookLMAdapter {
  private session: SessionManager
  private reqIdCounter = 100000
  private conversationCache: Map<string, Array<{ query: string; answer: string; turnNumber: number }>> = new Map()
  private circuitBreaker = new CircuitBreaker(5, 60_000, 'notebooklm')

  constructor (session: SessionManager) {
    this.session = session
  }

  private async rpcCall (
    method: RPCMethodId,
    params: unknown[],
    sourcePath = '/',
    allowNull = false
  ): Promise<unknown> {
    return this.circuitBreaker.execute(() =>
      withRetry(
        () => this.doRpcCall(method, params, sourcePath, allowNull),
        `rpc:${method}`,
        { maxRetries: 2 }
      )
    )
  }

  private async doRpcCall (
    method: RPCMethodId,
    params: unknown[],
    sourcePath = '/',
    allowNull = false
  ): Promise<unknown> {
    const auth = this.session.getAuth()
    const url = buildBatchUrl(method, auth.sessionId, sourcePath)
    const rpcRequest = encodeRpcRequest(method, params)
    const body = buildRequestBody(rpcRequest, auth.csrfToken)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Cookie: buildCookieHeader(auth.cookies),
        },
        body,
        signal: controller.signal,
      })

      if (response.status === 401 || response.status === 403) {
        throw new AdapterError('Authentication expired or forbidden', 'AUTH_EXPIRED')
      }

      if (!response.ok) {
        throw new AdapterError(
          `HTTP ${response.status}: ${response.statusText}`,
          'UNKNOWN_UPSTREAM_ERROR'
        )
      }

      const text = await response.text()
      return decodeResponse(text, method, allowNull)
    } catch (err) {
      if (err instanceof AdapterError) throw err

      if (err instanceof RPCError) {
        if (err.message.includes('rate limit') || err.code === 'USER_DISPLAYABLE_ERROR') {
          throw new AdapterError('Rate limited by NotebookLM API', 'RATE_LIMITED')
        }
        throw new AdapterError(`RPC error: ${err.message}`, 'UNKNOWN_UPSTREAM_ERROR')
      }

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AdapterError('Request timed out', 'NOTEBOOKLM_TIMEOUT')
      }

      throw new AdapterError(
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        'UNKNOWN_UPSTREAM_ERROR'
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async listNotebooks (): Promise<NotebookInfo[]> {
    logger.info('Listing notebooks')

    const result = await this.rpcCall(RPCMethod.LIST_NOTEBOOKS, [null, 1, null, [2]])

    if (!result || !Array.isArray(result) || result.length === 0) {
      return []
    }

    const rawNotebooks: unknown[][] = Array.isArray(result[0]) ? result[0] : result
    return rawNotebooks.map((nb: unknown[]) => this.parseNotebook(nb))
  }

  async getNotebookMetadata (notebookId: string): Promise<NotebookMetadata> {
    logger.info({ notebookId }, 'Getting notebook metadata')

    const result = await this.rpcCall(
      RPCMethod.GET_NOTEBOOK,
      [notebookId, null, [2], null, 0],
      `/notebook/${notebookId}`
    )

    if (!result || !Array.isArray(result)) {
      throw new AdapterError(`Notebook not found: ${notebookId}`, 'NOTEBOOK_NOT_FOUND')
    }

    const nbInfo = Array.isArray(result[0]) ? result[0] : []
    const notebook = this.parseNotebook(nbInfo)

    let sourcesCount = 0
    try {
      if (Array.isArray(nbInfo) && nbInfo.length > 1 && Array.isArray(nbInfo[1])) {
        sourcesCount = nbInfo[1].length
      }
    } catch { /* ignore */ }

    let summary = ''
    const suggestedTopics: Array<{ question: string; prompt: string }> = []

    try {
      const summaryResult = await this.rpcCall(
        RPCMethod.SUMMARIZE,
        [notebookId, [2]],
        `/notebook/${notebookId}`
      )

      if (Array.isArray(summaryResult)) {
        if (summaryResult.length > 0 && Array.isArray(summaryResult[0]) && summaryResult[0].length > 0) {
          summary = typeof summaryResult[0][0] === 'string' ? summaryResult[0][0] : ''
        }
        if (summaryResult.length > 1 && Array.isArray(summaryResult[1]) && Array.isArray(summaryResult[1][0])) {
          for (const topic of summaryResult[1][0]) {
            if (Array.isArray(topic) && topic.length >= 2) {
              suggestedTopics.push({
                question: typeof topic[0] === 'string' ? topic[0] : '',
                prompt: typeof topic[1] === 'string' ? topic[1] : '',
              })
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, notebookId }, 'Failed to get notebook summary')
    }

    return {
      id: notebook.id,
      title: notebook.title,
      sourcesCount,
      summary,
      suggestedTopics,
    }
  }

  async askNotebook (
    notebookId: string,
    question: string,
    conversationId?: string
  ): Promise<AskResult> {
    logger.info({ notebookId, questionLength: question.length }, 'Asking notebook')

    const sourceIds = await this.getSourceIds(notebookId)

    const isNewConversation = !conversationId
    if (isNewConversation) {
      conversationId = uuidv4()
    }

    const conversationHistory = isNewConversation
      ? null
      : this.buildConversationHistory(conversationId!)

    const sourcesArray = sourceIds.map(sid => [[sid]])

    const params = [
      sourcesArray,
      question,
      conversationHistory,
      [2, null, [1], [1]],
      conversationId,
      null,
      null,
      notebookId,
      1,
    ]

    const auth = this.session.getAuth()
    const paramsJson = JSON.stringify(params)
    const fReq = [null, paramsJson]
    const fReqJson = JSON.stringify(fReq)

    const bodyParts = [`f.req=${encodeURIComponent(fReqJson)}`]
    if (auth.csrfToken) {
      bodyParts.push(`at=${encodeURIComponent(auth.csrfToken)}`)
    }
    const body = bodyParts.join('&') + '&'

    this.reqIdCounter += 100000
    const urlParams = new URLSearchParams({
      bl: process.env.NOTEBOOKLM_BL || DEFAULT_BL,
      hl: 'en',
      _reqid: String(this.reqIdCounter),
      rt: 'c',
    })
    if (auth.sessionId) {
      urlParams.set('f.sid', auth.sessionId)
    }

    const url = `${QUERY_URL}?${urlParams.toString()}`

    const controller = new AbortController()
    const askTimeout = setTimeout(() => controller.abort(), ASK_TIMEOUT)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Cookie: buildCookieHeader(auth.cookies),
        },
        body,
        signal: controller.signal,
      })

      if (response.status === 401 || response.status === 403) {
        throw new AdapterError('Authentication expired or forbidden', 'AUTH_EXPIRED')
      }

      if (!response.ok) {
        throw new AdapterError(
          `HTTP ${response.status}: ${response.statusText}`,
          'UNKNOWN_UPSTREAM_ERROR'
        )
      }

      const responseText = await response.text()
      const answerText = parseAskResponse(responseText)

      let turnNumber = 0
      if (answerText) {
        const turns = this.conversationCache.get(conversationId!) || []
        turnNumber = turns.length + 1
        turns.push({ query: question, answer: answerText, turnNumber })
        this.conversationCache.set(conversationId!, turns)
      }

      return {
        answer: answerText || 'No answer could be extracted from the response.',
        conversationId: conversationId!,
        turnNumber,
      }
    } catch (err) {
      if (err instanceof AdapterError) throw err
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AdapterError('Request timed out', 'NOTEBOOKLM_TIMEOUT')
      }
      throw new AdapterError(
        `Ask failed: ${err instanceof Error ? err.message : String(err)}`,
        'UNKNOWN_UPSTREAM_ERROR'
      )
    } finally {
      clearTimeout(askTimeout)
    }
  }

  private async getSourceIds (notebookId: string): Promise<string[]> {
    const result = await this.rpcCall(
      RPCMethod.GET_NOTEBOOK,
      [notebookId, null, [2], null, 0],
      `/notebook/${notebookId}`
    )

    const sourceIds: string[] = []
    if (!result || !Array.isArray(result)) return sourceIds

    try {
      if (Array.isArray(result[0]) && Array.isArray(result[0][1])) {
        for (const source of result[0][1]) {
          if (Array.isArray(source) && source.length > 0) {
            const first = source[0]
            if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'string') {
              sourceIds.push(first[0])
            }
          }
        }
      }
    } catch { /* ignore */ }

    return sourceIds
  }

  private buildConversationHistory (conversationId: string): unknown[] | null {
    const turns = this.conversationCache.get(conversationId)
    if (!turns?.length) return null

    const history: unknown[] = []
    for (const turn of turns) {
      history.push([turn.answer, null, 2])
      history.push([turn.query, null, 1])
    }
    return history
  }

  private parseNotebook (data: unknown[]): NotebookInfo {
    const rawTitle = data.length > 0 && typeof data[0] === 'string' ? data[0] : ''
    const title = rawTitle.replace('thought\n', '').trim()
    const id = data.length > 2 && typeof data[2] === 'string' ? data[2] : ''

    let createdAt: string | null = null
    if (data.length > 5 && Array.isArray(data[5]) && (data[5] as unknown[]).length > 5) {
      const tsData = (data[5] as unknown[])[5]
      if (Array.isArray(tsData) && tsData.length > 0 && typeof tsData[0] === 'number') {
        createdAt = new Date(tsData[0] * 1000).toISOString()
      }
    }

    let isOwner = true
    if (data.length > 5 && Array.isArray(data[5]) && (data[5] as unknown[]).length > 1) {
      isOwner = (data[5] as unknown[])[1] === false
    }

    return { id, title, createdAt, isOwner }
  }
}
