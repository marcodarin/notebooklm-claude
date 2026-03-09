import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { IncomingMessage, ServerResponse } from 'node:http'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { logger } from '../lib/logger.js'

const transports: Record<string, StreamableHTTPServerTransport> = {}

export function createMcpServer (): McpServer {
  const server = new McpServer(
    {
      name: 'notebooklm-bridge',
      version: '0.1.0',
    },
    {
      capabilities: { logging: {} },
    }
  )
  return server
}

export async function handleMcpPost (
  req: IncomingMessage & { body?: unknown; auth?: AuthInfo },
  res: ServerResponse,
  serverFactory: () => McpServer
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const requestId = randomUUID().slice(0, 8)

  logger.info({ requestId, sessionId: sessionId || 'new' }, 'MCP POST request')

  try {
    let transport: StreamableHTTPServerTransport

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId]
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          logger.info({ sessionId: sid }, 'Session initialized')
          transports[sid] = transport
        },
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && transports[sid]) {
          logger.info({ sessionId: sid }, 'Transport closed, removing session')
          delete transports[sid]
        }
      }

      const server = serverFactory()
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
      return
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      }))
      return
    }

    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    logger.error({ requestId, err: error }, 'Error handling MCP request')
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      }))
    }
  }
}

export async function handleMcpGet (
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined

  if (!sessionId || !transports[sessionId]) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Invalid or missing session ID')
    return
  }

  const lastEventId = req.headers['last-event-id']
  if (lastEventId) {
    logger.info({ sessionId }, 'Client reconnecting with Last-Event-ID')
  }

  const transport = transports[sessionId]
  await transport.handleRequest(req, res)
}

export async function handleMcpDelete (
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined

  if (!sessionId || !transports[sessionId]) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Invalid or missing session ID')
    return
  }

  logger.info({ sessionId }, 'Session termination request')

  try {
    const transport = transports[sessionId]
    await transport.handleRequest(req, res)
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Error handling session termination')
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error processing session termination')
    }
  }
}

export async function closeAllTransports (): Promise<void> {
  for (const sessionId in transports) {
    try {
      logger.info({ sessionId }, 'Closing transport')
      await transports[sessionId].close()
      delete transports[sessionId]
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Error closing transport')
    }
  }
}
