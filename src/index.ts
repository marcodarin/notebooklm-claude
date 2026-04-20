import express from 'express'
import { config } from './lib/config.js'
import { logger } from './lib/logger.js'
import {
  createMcpServer,
  handleMcpPost,
  handleMcpGet,
  handleMcpDelete,
  closeAllTransports,
} from './transport/mcp-transport.js'
import { registerAllTools } from './tools/index.js'
import { SessionManager } from './session/session-manager.js'
import { NotebookLMAdapter } from './adapter/notebooklm-adapter.js'

const app = express()

app.use(express.json())

function authMiddleware (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!config.mcpAuthToken) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${config.mcpAuthToken}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}

app.get('/health', (_req, res) => {
  const status = sessionManager.getStatus()
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    version: '0.1.0',
    notebooklm: status.initialized ? 'connected' : 'disconnected',
    session: {
      lastTokenRefresh: status.lastTokenRefresh
        ? new Date(status.lastTokenRefresh).toISOString()
        : null,
      tokenAgeSec: status.tokenAge,
      cookieExpiry: status.cookieExpiry
        ? new Date(status.cookieExpiry).toISOString()
        : null,
      nextRefresh: status.nextRefresh
        ? new Date(status.nextRefresh).toISOString()
        : null,
      refreshCount: status.refreshCount,
    },
  })
})

const sessionManager = new SessionManager(config.notebookLm.sessionStorePath)
let adapter: NotebookLMAdapter | undefined
let initInProgress = false

const INIT_MAX_RETRIES = 5
const INIT_BASE_DELAY_MS = 3000

async function initializeNotebookLM (): Promise<void> {
  if (initInProgress) return
  initInProgress = true

  for (let attempt = 1; attempt <= INIT_MAX_RETRIES; attempt++) {
    try {
      await sessionManager.initialize()
      adapter = new NotebookLMAdapter(sessionManager)
      logger.info('NotebookLM adapter ready')
      initInProgress = false
      return
    } catch (err) {
      const delay = Math.min(INIT_BASE_DELAY_MS * Math.pow(2, attempt - 1), 30000)
      logger.warn({ err, attempt, nextRetryMs: delay }, `NotebookLM init failed (attempt ${attempt}/${INIT_MAX_RETRIES}), retrying in ${delay}ms`)
      if (attempt < INIT_MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  initInProgress = false
  logger.error('NotebookLM init exhausted all retries. Use /admin/update-cookies or wait for next request to retry.')
}

async function ensureAdapter (): Promise<NotebookLMAdapter | undefined> {
  if (adapter) return adapter
  if (!initInProgress) {
    logger.info('Adapter not available, attempting lazy initialization')
    await initializeNotebookLM()
  }
  return adapter
}

app.post('/admin/update-cookies', authMiddleware, async (req, res) => {
  const storageState = req.body

  if (!storageState || !storageState.cookies || !Array.isArray(storageState.cookies)) {
    res.status(400).json({ error: 'Request body must be a Playwright storage_state.json object with a cookies array' })
    return
  }

  try {
    await sessionManager.updateCookies(JSON.stringify(storageState))

    if (!adapter) {
      adapter = new NotebookLMAdapter(sessionManager)
      logger.info('NotebookLM adapter created after cookie update')
    }

    const status = sessionManager.getStatus()
    res.json({
      status: 'ok',
      message: 'Cookies updated and tokens refreshed',
      session: {
        lastTokenRefresh: status.lastTokenRefresh
          ? new Date(status.lastTokenRefresh).toISOString()
          : null,
        refreshCount: status.refreshCount,
      },
    })
  } catch (err) {
    logger.error({ err }, 'Failed to update cookies')
    res.status(500).json({
      error: 'Failed to update cookies',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

function createConfiguredServer () {
  const server = createMcpServer()
  registerAllTools(server, adapter)
  return server
}

app.post('/mcp', authMiddleware, async (req, res) => {
  await ensureAdapter()
  handleMcpPost(req, res, createConfiguredServer)
})

app.get('/mcp', authMiddleware, (req, res) => {
  handleMcpGet(req, res)
})

app.delete('/mcp', authMiddleware, (req, res) => {
  handleMcpDelete(req, res)
})

async function start (): Promise<void> {
  await initializeNotebookLM()

  app.listen(config.port, '0.0.0.0', () => {
    logger.info({
      port: config.port,
      env: config.nodeEnv,
      auth: config.mcpAuthToken ? 'enabled' : 'disabled',
      notebooklm: adapter ? 'connected' : 'disconnected',
    }, 'NotebookLM MCP Bridge started')
  })
}

start().catch(err => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})

process.on('SIGINT', async () => {
  logger.info('Shutting down...')
  sessionManager.destroy()
  await closeAllTransports()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...')
  sessionManager.destroy()
  await closeAllTransports()
  process.exit(0)
})
