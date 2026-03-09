export class RPCError extends Error {
  rpcId?: string
  code?: unknown
  foundIds: string[]

  constructor (message: string, opts?: { rpcId?: string; code?: unknown; foundIds?: string[] }) {
    super(message)
    this.name = 'RPCError'
    this.rpcId = opts?.rpcId
    this.code = opts?.code
    this.foundIds = opts?.foundIds || []
  }
}

function stripAntiXssi (response: string): string {
  if (response.startsWith(")]}'")) {
    const match = response.match(/^\)\]\}'\r?\n/)
    if (match) {
      return response.slice(match[0].length)
    }
  }
  return response
}

function parseChunkedResponse (response: string): unknown[] {
  if (!response?.trim()) return []

  const chunks: unknown[] = []
  const lines = response.trim().split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    if (!line) {
      i++
      continue
    }

    const num = parseInt(line, 10)
    if (!isNaN(num) && String(num) === line) {
      i++
      if (i < lines.length) {
        try {
          chunks.push(JSON.parse(lines[i]))
        } catch {
          // skip malformed
        }
        i++
      }
    } else {
      try {
        chunks.push(JSON.parse(line))
      } catch {
        // skip
      }
      i++
    }
  }

  return chunks
}

function collectRpcIds (chunks: unknown[]): string[] {
  const ids: string[] = []
  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue
    const items = Array.isArray(chunk[0]) ? chunk : [chunk]
    for (const item of items) {
      if (!Array.isArray(item) || item.length < 2) continue
      if ((item[0] === 'wrb.fr' || item[0] === 'er') && typeof item[1] === 'string') {
        ids.push(item[1])
      }
    }
  }
  return ids
}

function containsUserDisplayableError (obj: unknown): boolean {
  if (typeof obj === 'string') return obj.includes('UserDisplayableError')
  if (Array.isArray(obj)) return obj.some(containsUserDisplayableError)
  if (obj && typeof obj === 'object') {
    return Object.values(obj).some(containsUserDisplayableError)
  }
  return false
}

function extractRpcResult (chunks: unknown[], rpcId: string): unknown {
  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue
    const items: unknown[][] = Array.isArray(chunk[0]) ? chunk : [chunk]

    for (const item of items) {
      if (!Array.isArray(item) || item.length < 3) continue

      if (item[0] === 'er' && item[1] === rpcId) {
        let errorMsg = item[2] ?? 'Unknown error'
        if (typeof errorMsg === 'number') errorMsg = `Error code: ${errorMsg}`
        throw new RPCError(String(errorMsg), { rpcId, code: item[2] })
      }

      if (item[0] === 'wrb.fr' && item[1] === rpcId) {
        const resultData = item[2]

        if (resultData === null && item.length > 5 && item[5] != null) {
          if (containsUserDisplayableError(item[5])) {
            throw new RPCError(
              'Request rejected by API - may indicate rate limiting or quota exceeded',
              { rpcId, code: 'USER_DISPLAYABLE_ERROR' }
            )
          }
        }

        if (typeof resultData === 'string') {
          try {
            return JSON.parse(resultData)
          } catch {
            return resultData
          }
        }
        return resultData
      }
    }
  }

  return null
}

export function decodeResponse (rawResponse: string, rpcId: string, allowNull = false): unknown {
  const cleaned = stripAntiXssi(rawResponse)
  const chunks = parseChunkedResponse(cleaned)
  const foundIds = collectRpcIds(chunks)

  let result: unknown
  try {
    result = extractRpcResult(chunks, rpcId)
  } catch (err) {
    if (err instanceof RPCError && !err.foundIds.length) {
      err.foundIds = foundIds
    }
    throw err
  }

  if (result === null && !allowNull) {
    if (foundIds.length && !foundIds.includes(rpcId)) {
      throw new RPCError(
        `No result found for RPC ID '${rpcId}'. Response contains IDs: ${foundIds.join(', ')}. The RPC method ID may have changed.`,
        { rpcId, foundIds }
      )
    }
    throw new RPCError(`No result found for RPC ID: ${rpcId}`, { rpcId })
  }

  return result
}

export function parseAskResponse (responseText: string): string {
  let text = responseText
  if (text.startsWith(")]}'")) {
    text = text.slice(4)
  }

  const lines = text.trim().split('\n')
  let longestAnswer = ''

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    const num = parseInt(line, 10)
    if (!isNaN(num) && String(num) === line) {
      i++
      if (i < lines.length) {
        const extracted = extractAnswerFromChunk(lines[i])
        if (extracted.text && extracted.isAnswer && extracted.text.length > longestAnswer.length) {
          longestAnswer = extracted.text
        }
        i++
      }
    } else {
      const extracted = extractAnswerFromChunk(line)
      if (extracted.text && extracted.isAnswer && extracted.text.length > longestAnswer.length) {
        longestAnswer = extracted.text
      }
      i++
    }
  }

  return longestAnswer
}

function extractAnswerFromChunk (jsonStr: string): { text: string | null; isAnswer: boolean } {
  let data: unknown
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return { text: null, isAnswer: false }
  }

  if (!Array.isArray(data)) return { text: null, isAnswer: false }

  for (const item of data) {
    if (!Array.isArray(item) || item.length < 3) continue
    if (item[0] !== 'wrb.fr') continue

    const innerJson = item[2]
    if (typeof innerJson !== 'string') continue

    try {
      const innerData = JSON.parse(innerJson)
      if (Array.isArray(innerData) && innerData.length > 0) {
        const first = innerData[0]
        if (Array.isArray(first) && first.length > 0) {
          const text = first[0]
          if (typeof text === 'string' && text.length > 20) {
            let isAnswer = false
            if (first.length > 4 && Array.isArray(first[4])) {
              const typeInfo = first[4]
              if (typeInfo.length > 0 && typeInfo[typeInfo.length - 1] === 1) {
                isAnswer = true
              }
            }
            return { text, isAnswer }
          }
        }
      }
    } catch {
      continue
    }
  }

  return { text: null, isAnswer: false }
}
