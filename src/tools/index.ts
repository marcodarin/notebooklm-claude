import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerPingTool } from './ping.js'
import { registerListNotebooks, registerAskNotebook } from './notebook-tools.js'
import { registerSelectNotebook, registerGetNotebookMetadata } from './session-tools.js'
import { NotebookLMAdapter } from '../adapter/notebooklm-adapter.js'

export function registerAllTools (server: McpServer, adapter?: NotebookLMAdapter): void {
  registerPingTool(server)

  if (adapter) {
    registerListNotebooks(server, adapter)
    registerAskNotebook(server, adapter)
    registerSelectNotebook(server, adapter)
    registerGetNotebookMetadata(server, adapter)
  }
}
