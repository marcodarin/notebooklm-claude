# NotebookLM MCP Bridge per Claude Web

Interroga i notebook di Google NotebookLM direttamente dalla webapp di Claude.

```
Claude Web → Custom Connector → Server MCP (Render) → Google NotebookLM API
```

## Tool disponibili

| Tool | Descrizione |
|------|-------------|
| `list_notebooks` | Elenca tutti i notebook accessibili |
| `ask_notebook` | Fa una domanda grounded sulle fonti di un notebook |
| `select_notebook` | Imposta un notebook predefinito per la sessione |
| `get_notebook_metadata` | Titolo, numero fonti, summary e topic suggeriti |
| `ping` | Health check del server |

---

## Collegare il proprio account Claude

Il server MCP è già attivo su Render. Per usarlo dal tuo Claude:

### 1. Condividi i tuoi notebook

Il server accede a NotebookLM con un account Google di servizio. Per rendere visibili i tuoi notebook:

1. Apri [notebooklm.google.com](https://notebooklm.google.com/)
2. Apri il notebook che vuoi rendere accessibile da Claude
3. Clicca **Condividi** (icona in alto a destra)
4. Aggiungi l'account di servizio: **marco@larin.it**
5. Imposta il permesso su **Viewer** (lettura)
6. Ripeti per ogni notebook che vuoi usare

In alternativa puoi condividere un notebook con "Chiunque abbia il link" — il server lo vedrà automaticamente tramite `list_notebooks`.

### 2. Aggiungi il connector in Claude

1. Vai su **[claude.ai/settings/connectors](https://claude.ai/settings/connectors)**
2. Clicca **Add**
3. Inserisci come URL:

```
https://notebooklm-mcp-bridge.onrender.com/mcp
```

4. Salva

Serve un piano Claude **Pro, Max, Team o Enterprise** — il piano free non supporta i custom connector.

### 3. Usa in chat

Apri una nuova conversazione su [claude.ai](https://claude.ai) e prova:

- *"Elenca i notebook NotebookLM disponibili"*
- *"Chiedi al notebook [titolo] quali sono i punti principali"*
- *"Dammi i metadati del notebook con ID [id]"*

Claude chiamerà automaticamente i tool del bridge.

---

## Note

- **Cold start**: il server (piano free Render) va in sleep dopo ~15 min di inattività. La prima richiesta dopo lo sleep impiega 30-60 secondi.
- **Tempi di risposta**: `list_notebooks` è rapido (~1-2s). `ask_notebook` impiega 15-30 secondi perché NotebookLM deve elaborare la risposta AI.
- **Solo lettura**: il bridge non crea né modifica notebook o fonti.
- **API non ufficiali**: il bridge usa API interne di Google. Potrebbe smettere di funzionare se cambiano.

---

## Sviluppo locale

```bash
npm ci

mkdir -p /tmp/notebooklm-session
cp ~/.notebooklm/storage_state.json /tmp/notebooklm-session/

npm run dev
# http://localhost:10000/health
# http://localhost:10000/mcp
```

## Struttura progetto

```
src/
├── index.ts                    # Entry point Express
├── adapter/                    # Comunicazione con NotebookLM (RPC batchexecute)
├── session/                    # Gestione cookie/token Google
├── transport/                  # Server MCP Streamable HTTP
├── tools/                      # Tool esposti a Claude
└── lib/                        # Config, logger, retry/circuit breaker
```
