export const BATCHEXECUTE_URL = 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute'
export const QUERY_URL = 'https://notebooklm.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed'
export const NOTEBOOKLM_HOME = 'https://notebooklm.google.com/'

export const RPCMethod = {
  LIST_NOTEBOOKS: 'wXbhsf',
  GET_NOTEBOOK: 'rLM1Ne',
  SUMMARIZE: 'VfAZjd',
} as const

export type RPCMethodId = typeof RPCMethod[keyof typeof RPCMethod]
