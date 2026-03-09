import * as z from 'zod/v4'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { logger } from '../lib/logger.js'
import { NotebookLMAdapter } from '../adapter/notebooklm-adapter.js'

export function registerListNotebooks (server: McpServer, adapter: NotebookLMAdapter): void {
  server.registerTool('list_notebooks', {
    title: 'List Notebooks',
    description: 'Returns the list of notebooks available in the configured NotebookLM account. Each notebook includes its ID, title, creation date, and ownership status.',
    inputSchema: {},
  }, async () => {
    const startTime = Date.now()
    logger.info({ tool: 'list_notebooks' }, 'Tool called')

    try {
      const notebooks = await adapter.listNotebooks()
      const duration = Date.now() - startTime
      logger.info({ tool: 'list_notebooks', count: notebooks.length, duration }, 'Tool completed')

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            notebooks: notebooks.map(nb => ({
              notebook_id: nb.id,
              title: nb.title,
              created_at: nb.createdAt,
              is_owner: nb.isOwner,
            })),
            count: notebooks.length,
          }, null, 2),
        }],
      }
    } catch (err) {
      logger.error({ tool: 'list_notebooks', err }, 'Tool failed')
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

export function registerAskNotebook (server: McpServer, adapter: NotebookLMAdapter): void {
  server.registerTool('ask_notebook', {
    title: 'Ask Notebook',
    description: 'Ask a question to a NotebookLM notebook. The answer is grounded on the sources within the notebook. Optionally provide a conversation_id for follow-up questions.',
    inputSchema: {
      notebook_id: z.string().describe('The ID of the notebook to query'),
      question: z.string().describe('The question to ask'),
      conversation_id: z.string().optional().describe('Conversation ID for follow-up questions. Omit for new conversations.'),
    },
  }, async ({ notebook_id, question, conversation_id }) => {
    const startTime = Date.now()
    logger.info({ tool: 'ask_notebook', notebookId: notebook_id, questionLength: question.length }, 'Tool called')

    try {
      const result = await adapter.askNotebook(notebook_id, question, conversation_id)
      const duration = Date.now() - startTime
      logger.info({ tool: 'ask_notebook', duration, answerLength: result.answer.length }, 'Tool completed')

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            answer: result.answer,
            conversation_id: result.conversationId,
            turn_number: result.turnNumber,
            notebook_id,
          }, null, 2),
        }],
      }
    } catch (err) {
      logger.error({ tool: 'ask_notebook', err }, 'Tool failed')
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
