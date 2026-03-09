import * as z from 'zod/v4'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { logger } from '../lib/logger.js'
import { NotebookLMAdapter } from '../adapter/notebooklm-adapter.js'

let selectedNotebookId: string | null = null
let selectedNotebookTitle: string | null = null

export function getSelectedNotebookId (): string | null {
  return selectedNotebookId
}

export function registerSelectNotebook (server: McpServer, adapter: NotebookLMAdapter): void {
  server.registerTool('select_notebook', {
    title: 'Select Notebook',
    description: 'Set the active notebook for the session. After selecting, you can use ask_notebook without specifying the notebook_id each time.',
    inputSchema: {
      notebook_id: z.string().describe('The ID of the notebook to select'),
    },
  }, async ({ notebook_id }) => {
    logger.info({ tool: 'select_notebook', notebookId: notebook_id }, 'Tool called')

    try {
      const metadata = await adapter.getNotebookMetadata(notebook_id)
      selectedNotebookId = notebook_id
      selectedNotebookTitle = metadata.title

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'selected',
            notebook_id: metadata.id,
            title: metadata.title,
            sources_count: metadata.sourcesCount,
            summary: metadata.summary ? metadata.summary.slice(0, 500) : null,
          }, null, 2),
        }],
      }
    } catch (err) {
      logger.error({ tool: 'select_notebook', err }, 'Tool failed')
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : 'Unknown error',
            code: (err as { code?: string }).code || 'UNKNOWN',
          }),
        }],
        isError: true,
      }
    }
  })
}

export function registerGetNotebookMetadata (server: McpServer, adapter: NotebookLMAdapter): void {
  server.registerTool('get_notebook_metadata', {
    title: 'Get Notebook Metadata',
    description: 'Retrieve metadata about a notebook including title, source count, summary, and suggested topics.',
    inputSchema: {
      notebook_id: z.string().describe('The ID of the notebook'),
    },
  }, async ({ notebook_id }) => {
    logger.info({ tool: 'get_notebook_metadata', notebookId: notebook_id }, 'Tool called')

    try {
      const metadata = await adapter.getNotebookMetadata(notebook_id)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            notebook_id: metadata.id,
            title: metadata.title,
            sources_count: metadata.sourcesCount,
            summary: metadata.summary,
            suggested_topics: metadata.suggestedTopics,
          }, null, 2),
        }],
      }
    } catch (err) {
      logger.error({ tool: 'get_notebook_metadata', err }, 'Tool failed')
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : 'Unknown error',
            code: (err as { code?: string }).code || 'UNKNOWN',
          }),
        }],
        isError: true,
      }
    }
  })
}
