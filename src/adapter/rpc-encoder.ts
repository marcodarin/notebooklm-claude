import { RPCMethodId } from './rpc-constants.js'

export function encodeRpcRequest (method: RPCMethodId, params: unknown[]): unknown[][] {
  const paramsJson = JSON.stringify(params)
  const inner = [method, paramsJson, null, 'generic']
  return [[inner]]
}

export function buildRequestBody (rpcRequest: unknown[][], csrfToken?: string): string {
  const fReq = JSON.stringify(rpcRequest)
  const parts = [`f.req=${encodeURIComponent(fReq)}`]

  if (csrfToken) {
    parts.push(`at=${encodeURIComponent(csrfToken)}`)
  }

  return parts.join('&') + '&'
}

export function buildBatchUrl (
  method: RPCMethodId,
  sessionId: string,
  sourcePath = '/'
): string {
  const params = new URLSearchParams({
    rpcids: method,
    'source-path': sourcePath,
    'f.sid': sessionId,
    hl: 'en',
    rt: 'c',
  })
  return `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?${params.toString()}`
}
