import * as z from 'zod/v4'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { logger } from '../lib/logger.js'

export function registerPingTool (server: McpServer): void {
  server.registerTool('ping', {
    title: 'Ping',
    description: 'Health check tool. Returns server status and uptime.',
    inputSchema: {
      echo: z.string().optional().describe('Optional string to echo back'),
    },
  }, async ({ echo }) => {
    logger.info({ tool: 'ping' }, 'Tool called')

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'ok',
          server: 'notebooklm-bridge',
          version: '0.1.0',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          echo: echo || undefined,
        }, null, 2),
      }],
    }
  })
}
