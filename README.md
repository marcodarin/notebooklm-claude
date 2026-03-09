# NotebookLM MCP Bridge per Claude Web

Questo progetto consente di interrogare i propri notebook di Google NotebookLM direttamente dalla webapp di Claude, usando un server MCP remoto.

## Come funziona

```
Claude Web → Custom Connector → Server MCP (Render) → Google NotebookLM API
```

Claude chiama i tool esposti dal server MCP. Il server usa i cookie di sessione Google per comunicare con NotebookLM tramite le sue API interne (batchexecute RPC). Non serve browser headless a runtime.

## Tool disponibili

| Tool | Descrizione |
|------|-------------|
| `list_notebooks` | Elenca tutti i notebook del tuo account NotebookLM |
| `ask_notebook` | Fa una domanda a un notebook — la risposta è basata sulle fonti |
| `select_notebook` | Imposta un notebook come predefinito per la sessione |
| `get_notebook_metadata` | Restituisce titolo, numero fonti, summary e topic suggeriti |
| `ping` | Health check del server |

---

## Guida setup completa

### Prerequisiti

- **Python 3.10+** (per lo script di login)
- **Node.js 20+** e npm
- Un account **Google** con accesso a [NotebookLM](https://notebooklm.google.com/)
- Un account **Claude** con piano **Pro, Max, Team o Enterprise** (i custom connector non sono disponibili sul piano free)
- Un account **Render** gratuito su [render.com](https://render.com)
- Un account **GitHub** (per il deploy automatico)

---

### Step 1 — Fork del repository

1. Vai su **https://github.com/marcodarin/notebooklm-claude**
2. Clicca **Fork** in alto a destra
3. Crea il fork nel tuo account GitHub

---

### Step 2 — Ottieni i cookie di sessione Google

Lo script di login apre un browser, ti fa autenticare su Google e salva i cookie necessari. Questi cookie permettono al server di accedere a NotebookLM per tuo conto.

#### Opzione A — Usa lo script incluso (consigliata)

```bash
# Clona il tuo fork
git clone https://github.com/TUO-USERNAME/notebooklm-claude.git
cd notebooklm-claude

# Installa Python 3.12 (macOS)
brew install python@3.12

# Installa notebooklm-py con supporto browser
brew install pipx
pipx install --python /opt/homebrew/bin/python3.12 "notebooklm-py[browser]"

# Installa Chromium per Playwright
~/.local/pipx/venvs/notebooklm-py/bin/playwright install chromium

# Esegui lo script di login
~/.local/pipx/venvs/notebooklm-py/bin/python scripts/login.py
```

Si aprirà un browser Chromium:
1. Fai il login con il tuo account Google
2. Aspetta che la pagina di NotebookLM si carichi (vedrai i tuoi notebook)
3. Lo script salverà automaticamente i cookie e chiuderà il browser

I cookie vengono salvati in `~/.notebooklm/storage_state.json`.

#### Opzione B — Usa la CLI di notebooklm-py

```bash
notebooklm login
```

Segui le istruzioni a schermo. I cookie vengono salvati nello stesso percorso.

#### Verifica

```bash
cat ~/.notebooklm/storage_state.json | python3 -c "
import sys, json
data = json.load(sys.stdin)
cookies = data.get('cookies', [])
has_sid = any(c['name'] == 'SID' for c in cookies)
print(f'Cookie trovati: {len(cookies)}')
print(f'SID presente: {has_sid}')
if has_sid:
    print('✓ Autenticazione OK')
else:
    print('✗ Manca il cookie SID — ripeti il login')
"
```

---

### Step 3 — Deploy su Render

#### 3.1 Crea un account Render

Se non hai già un account, registrati su [render.com](https://render.com) (piano gratuito).

#### 3.2 Crea un nuovo Web Service

1. Vai su [dashboard.render.com](https://dashboard.render.com)
2. Clicca **New** → **Web Service**
3. Seleziona **Build and deploy from a Git repository**
4. Connetti il tuo account GitHub se richiesto
5. Seleziona il repository `notebooklm-claude` dal tuo fork
6. Configura:

| Campo | Valore |
|-------|--------|
| **Name** | `notebooklm-mcp-bridge` (o un nome a scelta) |
| **Region** | Frankfurt (EU) o il più vicino a te |
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `npm ci && npm run build` |
| **Start Command** | `npm run start` |
| **Plan** | Free |

#### 3.3 Aggiungi le variabili d'ambiente

Nella sezione **Environment Variables**, aggiungi:

| Chiave | Valore |
|--------|--------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `LOG_LEVEL` | `info` |
| `NOTEBOOKLM_AUTH_JSON` | *(vedi sotto)* |

Per il valore di `NOTEBOOKLM_AUTH_JSON`, copia **l'intero contenuto** del file `~/.notebooklm/storage_state.json`:

```bash
# macOS — copia negli appunti
cat ~/.notebooklm/storage_state.json | pbcopy
```

Incolla il contenuto copiato come valore della variabile `NOTEBOOKLM_AUTH_JSON` su Render.

#### 3.4 Lancia il deploy

Clicca **Create Web Service**. Il build impiega circa 1-2 minuti.

#### 3.5 Verifica

Quando il deploy è completato, il servizio avrà un URL tipo:

```
https://notebooklm-mcp-bridge.onrender.com
```

Verifica che funzioni:

```bash
curl https://TUO-SERVIZIO.onrender.com/health
```

Dovresti vedere:

```json
{"status":"ok","uptime":10,"version":"0.1.0","notebooklm":"connected"}
```

Se vedi `"notebooklm":"disconnected"`, controlla che la variabile `NOTEBOOKLM_AUTH_JSON` sia stata inserita correttamente.

---

### Step 4 — Collega a Claude Web

1. Vai su **[claude.ai/settings/connectors](https://claude.ai/settings/connectors)**
2. Clicca **Add** nella sezione dei connector
3. Compila:

| Campo | Valore |
|-------|--------|
| **URL** | `https://TUO-SERVIZIO.onrender.com/mcp` |

4. Salva

Claude rileverà automaticamente i tool disponibili.

---

### Step 5 — Usa in Claude

Apri una nuova chat su [claude.ai](https://claude.ai) e prova:

> "Elenca i miei notebook NotebookLM"

Claude chiamerà `list_notebooks` e ti mostrerà l'elenco.

> "Chiedi al notebook *Company Operational Guidelines* quali sono i valori aziendali"

Claude chiamerà `ask_notebook` e restituirà una risposta basata sulle fonti del notebook.

> "Dammi i metadati del notebook con ID abc123..."

Claude chiamerà `get_notebook_metadata` per titolo, sommario e domande suggerite.

---

## Note importanti

### Cold start (piano gratuito Render)

Sul piano free di Render, il server va in sleep dopo ~15 minuti di inattività. La prima richiesta dopo lo sleep impiega **30-60 secondi** per riattivarsi. Le richieste successive sono veloci (~1-2 secondi per list, ~15-30 secondi per ask).

### Scadenza dei cookie

I cookie di sessione Google scadono dopo alcune settimane. Quando succede:

1. Il health check mostrerà `"notebooklm":"disconnected"`
2. I tool restituiranno errore `AUTH_EXPIRED`

Per risolvere:

```bash
# Ripeti il login
~/.local/pipx/venvs/notebooklm-py/bin/python scripts/login.py

# Copia i nuovi cookie
cat ~/.notebooklm/storage_state.json | pbcopy

# Aggiorna la variabile su Render
# Dashboard → Service → Environment → NOTEBOOKLM_AUTH_JSON → incolla → Save
```

Render ri-deployerà automaticamente con i nuovi cookie.

### Sicurezza

- I cookie di sessione Google danno accesso al tuo account NotebookLM. **Non condividerli mai.**
- Il server è attualmente authless (senza autenticazione). Chiunque conosca l'URL può chiamare i tool. Per un uso interno/prototipo questo è accettabile. Per produzione, considera di aggiungere OAuth.
- L'URL del server su Render non è indicizzato da motori di ricerca, ma non è un segreto. Non condividerlo pubblicamente.

### Limiti

- Il bridge usa API interne non ufficiali di Google — potrebbe smettere di funzionare se Google cambia l'interfaccia di NotebookLM.
- Le risposte di `ask_notebook` possono impiegare 15-30 secondi (è l'AI di NotebookLM che elabora).
- Non supporta la creazione o modifica di notebook/fonti — solo lettura e interrogazione.

---

## Sviluppo locale

```bash
# Installa dipendenze
npm ci

# Copia i cookie nella posizione locale
mkdir -p /tmp/notebooklm-session
cp ~/.notebooklm/storage_state.json /tmp/notebooklm-session/

# Avvia in dev mode
npm run dev

# Il server sarà su http://localhost:10000
# Health check: http://localhost:10000/health
# Endpoint MCP: http://localhost:10000/mcp
```

### Test rapido

```bash
# Health
curl http://localhost:10000/health

# Init MCP session
curl -s http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## Struttura del progetto

```
src/
├── index.ts                    # Entry point, Express server
├── adapter/
│   ├── rpc-constants.ts        # Endpoint e metodi RPC NotebookLM
│   ├── rpc-encoder.ts          # Encoding richieste batchexecute
│   ├── rpc-decoder.ts          # Decoding risposte RPC
│   └── notebooklm-adapter.ts   # Adapter con retry + circuit breaker
├── session/
│   └── session-manager.ts      # Gestione cookie/token Google
├── transport/
│   └── mcp-transport.ts        # Server MCP Streamable HTTP
├── tools/
│   ├── index.ts                # Registrazione tool
│   ├── ping.ts                 # Health check tool
│   ├── notebook-tools.ts       # list_notebooks, ask_notebook
│   └── session-tools.ts        # select_notebook, get_notebook_metadata
└── lib/
    ├── config.ts               # Configurazione da env vars
    ├── logger.ts               # Logger pino
    └── resilience.ts           # Retry + circuit breaker
```
