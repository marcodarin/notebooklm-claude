export const config = {
  port: parseInt(process.env.PORT || '10000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',
  headless: process.env.HEADLESS !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info',
  notebookLm: {
    defaultNotebookUrl: process.env.NOTEBOOKLM_DEFAULT_NOTEBOOK_URL || '',
    serviceAccountMode: process.env.GOOGLE_SERVICE_ACCOUNT_MODE || 'browser',
    sessionStorePath: process.env.SESSION_STORE_PATH || '/tmp/notebooklm-session',
  },
} as const
