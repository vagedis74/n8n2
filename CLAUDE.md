# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n Enterprise deployment with header-based SSO authentication via Azure AD App Proxy. Uses Docker Compose to orchestrate Traefik, n8n, PostgreSQL, Redis, and worker containers.

## Common Commands

```bash
# Start deployment (builds image and starts all services)
./start.sh

# Stop deployment
./stop.sh

# View logs
docker compose logs -f
docker compose logs -f n8n        # specific service

# Restart services
docker compose restart

# Rebuild after changes
docker compose build && docker compose up -d

# Access container shell
docker exec -it n8n sh
docker exec -it n8n-postgres psql -U n8n -d n8n
```

## n8n API Helper

The `n8n-api.sh` script provides quick access to the n8n REST API:

```bash
./n8n-api.sh workflows              # List all workflows
./n8n-api.sh workflow <id>          # Get workflow details
./n8n-api.sh users                  # List all users
./n8n-api.sh executions [limit]     # List executions (default: 20)
./n8n-api.sh execution <id>         # Get execution details
./n8n-api.sh activate <id>          # Activate a workflow
./n8n-api.sh deactivate <id>        # Deactivate a workflow
./n8n-api.sh run <id> [json_data]   # Run a workflow
./n8n-api.sh health                 # Health check
./n8n-api.sh raw <METHOD> <path>    # Raw API request
```

## Architecture

```
Azure AD App Proxy (X-MS-CLIENT-PRINCIPAL-NAME header)
          │
          ▼
┌─────────────────────┐
│  Traefik (443/80)   │  TLS termination, routing, header middleware
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌──────────┐
│  n8n    │  │ n8n-worker│  Queue-based execution
│ (5678)  │  │          │
└────┬────┘  └────┬─────┘
     │            │
     └─────┬──────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌───────┐
│PostgreSQL│  │ Redis │  Data + Queue backend
└─────────┘  └───────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Service definitions, environment variables, volumes |
| `Dockerfile` | Custom n8n image with enterprise feature patches |
| `hooks.js` | SSO authentication middleware (extracts email from Azure AD headers) |
| `.env` | Secrets: DB credentials, JWT secret, encryption key |
| `traefik/dynamic/headers.yml` | Azure AD header forwarding, security headers |
| `traefik/dynamic/tls.yml` | TLS certificate configuration |
| `claude-http-wrapper.py` | HTTP wrapper exposing Claude CLI for n8n |
| `n8n-api.sh` | CLI helper for n8n REST API operations |
| `workflows-export/` | Exported n8n workflow JSON files |
| `local-files/` | Files accessible inside n8n at `/files` |

## Access Points

- **n8n Editor:** https://n8nsso.inlumi.education
- **Traefik Dashboard:** http://localhost:8080
- **REST API:** https://n8nsso.inlumi.education/api/v1/
- **Webhooks:** https://n8nsso.inlumi.education/webhook/

## SSO Authentication Flow

1. Azure AD App Proxy authenticates user
2. Proxy forwards `X-MS-CLIENT-PRINCIPAL-NAME` header with user email
3. Traefik `azure-headers` middleware passes header to n8n
4. `hooks.js` intercepts requests and creates/authenticates user session

### SSO Debugging

Enable debug logging to see incoming headers:
```bash
# In docker-compose.yml, set:
N8N_SSO_DEBUG: "true"

# Then view logs:
docker compose logs -f n8n | grep SSO
```

## SSE Push Backend

n8n uses Server-Sent Events (SSE) instead of WebSockets for real-time browser updates. This is configured for Azure AD Application Proxy compatibility.

```yaml
# In docker-compose.yml
N8N_PUSH_BACKEND: sse    # Options: sse, websocket
```

| Feature | SSE | WebSockets |
|---------|-----|------------|
| Protocol | Standard HTTP | Upgrade to ws:// |
| Direction | Server → Client | Bidirectional |
| Proxy compatibility | Works through most proxies | Often problematic |
| Azure AD App Proxy | Works out of the box | Requires configuration |

### Testing SSE Connection

```bash
# Basic connection test (expects :ok and :ping responses)
curl -sk -N "https://localhost/rest/push?pushRef=test-session" \
  -H "Host: n8nsso.inlumi.education" \
  -H "Accept: text/event-stream" \
  -H "X-Forwarded-Email: wouter.bon@inlumi.com" \
  --max-time 10
```

Expected responses:
- `:ok` - Connection established
- `:ping` - Keep-alive heartbeat (prevents proxy timeout)

### Monitoring Workflow Events

```bash
# Terminal 1: Listen for SSE events
curl -sk -N "https://localhost/rest/push?pushRef=my-session" \
  -H "Host: n8nsso.inlumi.education" \
  -H "Accept: text/event-stream" \
  -H "X-Forwarded-Email: wouter.bon@inlumi.com"

# Terminal 2: Trigger a workflow to see events
./n8n-api.sh run <workflow-id>
```

Event types during execution: `executionStarted`, `nodeExecuteBefore`, `nodeExecuteAfter`, `executionFinished`

## Claude HTTP Wrapper

Exposes local Claude CLI as an HTTP API for n8n workflows to call.

### Start the Wrapper

```bash
./start-claude-wrapper.sh          # Foreground
python3 claude-http-wrapper.py &   # Background
```

Runs on `http://localhost:8765`. From inside Docker containers, access via `http://172.17.0.1:8765`.

### API Endpoints

**POST /chat** - Send prompt to Claude CLI
```bash
curl -X POST http://localhost:8765/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "your prompt", "system": "optional system prompt"}'
```

**GET /health** - Health check
```bash
curl http://localhost:8765/health
```

### FortiGate AI Command Interpreter

The "FortiGate AI Command Interpreter (Webhook)" workflow uses Claude to translate natural language into FortiGate REST API calls.

**Workflow ID:** `g56KAd0SA1Gwj7Hw`
**Endpoint:** `POST /webhook/fortigate-ai`
**FortiGate API:** `https://nlfmfw1a.epm-cloud.net`
**Access:** Local only (external access blocked by Azure AD App Proxy)

#### Usage

Access via localhost (requires SSH or local shell):

**1. Interpret only** (review command before execution):
```bash
curl -sk -X POST "https://localhost/webhook/fortigate-ai" \
  -H "Host: n8nsso.inlumi.education" \
  -H "Content-Type: application/json" \
  -d '{"message": "show system status"}'
```
Returns: `{"status": "interpreted", "command": {...}, "message": "Add 'execute': true..."}`

**2. Execute** (run the command against FortiGate):
```bash
curl -sk -X POST "https://localhost/webhook/fortigate-ai" \
  -H "Host: n8nsso.inlumi.education" \
  -H "Content-Type: application/json" \
  -d '{"message": "show system status", "execute": true}'
```
Returns: `{"status": "executed", "command": {...}, "response": {...}}`

#### Supported Commands

| Query | API Endpoint |
|-------|--------------|
| show system status | GET /api/v2/monitor/system/status |
| show firewall policies | GET /api/v2/cmdb/firewall/policy |
| list interfaces | GET /api/v2/cmdb/system/interface |
| show routes | GET /api/v2/cmdb/router/static |
| show HA status | GET /api/v2/monitor/system/ha-peer |
| list address objects | GET /api/v2/cmdb/firewall/address |

Claude interprets natural language variations, so "show me all the firewall rules" works the same as "list firewall policies".

## MCP Server Configuration

Claude Code connects to external tools via MCP (Model Context Protocol) servers.

### Adding MCP Servers

```bash
# HTTP transport (recommended for cloud services)
claude mcp add --transport http <name> <url>
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# With authentication header
claude mcp add --transport http api https://api.example.com/mcp \
  --header "Authorization: Bearer $TOKEN"

# Local stdio server
claude mcp add --transport stdio <name> -- <command> [args...]
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://user:pass@host:5432/db"
```

### Configuration Scopes

| Scope | Location | Use Case |
|-------|----------|----------|
| local | `~/.claude.json` | Personal, project-specific |
| project | `.mcp.json` | Team-shared, version controlled |
| user | `~/.claude.json` | Cross-project utilities |

### Project MCP Config (`.mcp.json`)

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "local-db": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@bytebase/dbhub", "--dsn", "${DB_CONNECTION_STRING}"]
    }
  }
}
```

### Managing Servers

```bash
claude mcp list              # List all servers
claude mcp get <name>        # Server details
claude mcp remove <name>     # Remove server
/mcp                         # Check status in Claude Code
```

### Using MCP in Conversations

```bash
# Reference resources with @
> Analyze @github:issue://123

# Execute MCP prompts as slash commands
> /mcp__github__pr_review 456
```

## Database Operations

```bash
# Access PostgreSQL directly
docker exec -it n8n-postgres psql -U n8n -d n8n

# Backup database
docker exec n8n-postgres pg_dump -U n8n n8n > backup.sql

# Restore database
docker exec -i n8n-postgres psql -U n8n n8n < backup.sql

# View users table
docker exec -it n8n-postgres psql -U n8n -d n8n -c "SELECT email, \"firstName\", \"lastName\", \"roleSlug\" FROM \"user\";"

# Check Redis queue
docker exec -it n8n-redis redis-cli KEYS '*'
```

## Worker Scaling

To add more workers, duplicate the `n8n-worker` service in `docker-compose.yml`:

```yaml
n8n-worker-2:
  image: n8n-enterprise:latest
  container_name: n8n-worker-2
  # ... same config as n8n-worker
```

## Environment Variables

Key environment variables in `.env`:

| Variable | Purpose |
|----------|---------|
| `N8N_HOST` | Public hostname for n8n |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Azure AD OIDC credentials |
| `JWT_SECRET` | Session signing key |
| `ENCRYPTION_KEY` | Data encryption (32+ chars) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database credentials |

## Chat Trigger Workflows with External APIs

When building chat workflows that use external APIs (like Microsoft 365 Copilot) instead of n8n's built-in AI agents, use the `lastNode` response mode with a Code node to extract and format the response.

### Problem

The `@n8n/n8n-nodes-langchain.chat` node with `responseNodes` mode doesn't work correctly with external API responses - it waits for input instead of returning the response.

### Solution Pattern

```
Chat Trigger (lastNode mode)
         │
         ▼
    External API calls
         │
         ▼
  Code Node (Extract Response)
    → outputs { text: "response" }
```

### Configuration

**1. Chat Trigger Node:**
```json
{
  "parameters": {
    "options": {
      "responseMode": "lastNode"
    }
  }
}
```

**2. Code Node (last node in workflow):**
```javascript
// Extract response from external API (e.g., Microsoft 365 Copilot)
const messages = $input.first().json.messages;
if (messages && messages.length > 1) {
  return [{ json: { text: messages[1].text } }];
}
return [{ json: { text: 'No response' } }];
```

### Example: Microsoft 365 Copilot Chat Workflow

**Workflow ID:** `wvim3sVAWQJVsFcc3k9mi` ("My workflow2")

```
When chat message received (lastNode)
         │
         ▼
Create a conversation (Copilot)
         │
         ▼
Send a message (Copilot)
  → returns { messages: [{text: "user msg"}, {text: "bot response"}] }
         │
         ▼
Extract Response (Code)
  → returns { text: "bot response" }
```

### Key Points

- Use `lastNode` mode, NOT `responseNodes` mode for external APIs
- The last node must output `{ text: "..." }` for the chat to display it
- Don't use `@n8n/n8n-nodes-langchain.chat` as response node - use a Code node instead
- Microsoft 365 Copilot returns `messages[0]` = user input, `messages[1]` = bot response

## Troubleshooting

**SSL certificate errors when testing locally:**
```bash
# Use -k flag to skip SSL verification
curl -sk https://localhost/healthz -H "Host: n8nsso.inlumi.education"
```

**User not being auto-provisioned:**
- Check `N8N_SSO_AUTO_PROVISION` is `true`
- Verify headers are reaching n8n (enable `N8N_SSO_DEBUG`)
- Check role exists: `docker exec -it n8n-postgres psql -U n8n -d n8n -c "SELECT * FROM role;"`

**Webhook not accessible:**
- Webhooks are excluded from SSO: check `N8N_AUTH_EXCLUDE_ENDPOINTS` includes `webhook`
- Test locally: `curl -sk https://localhost/webhook/<path> -H "Host: n8nsso.inlumi.education"`

**Claude wrapper not responding:**
- Check if running: `pgrep -f claude-http-wrapper`
- View logs: `cat claude-wrapper.log`
- Restart: `pkill -f claude-http-wrapper.py && python3 claude-http-wrapper.py &`
