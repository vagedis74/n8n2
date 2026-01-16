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
| `start-claude-wrapper.sh` | Startup script for Claude wrapper service |

## Access Points

- **n8n Editor:** https://n8nsso.inlumi.education
- **Traefik Dashboard:** http://localhost:8080
- **API:** https://n8nsso.inlumi.education/rest/

## SSO Authentication Flow

1. Azure AD App Proxy authenticates user
2. Proxy forwards `X-MS-CLIENT-PRINCIPAL-NAME` header with user email
3. Traefik `azure-headers` middleware passes header to n8n
4. `hooks.js` intercepts requests and creates/authenticates user session

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

### n8n Webhook Integration

The "FortiGate AI Command Interpreter (Webhook)" workflow uses this wrapper to translate natural language into FortiGate API calls.

**FortiGate API:** `https://nlfmfw1a.epm-cloud.net`

```bash
# Test command interpretation
curl -s -k -X POST "https://localhost/webhook/fortigate-ai" \
  -H "Content-Type: application/json" \
  -H "Host: n8nsso.inlumi.education" \
  -d '{"message": "show firewall policies", "sessionId": "test-1"}'

# Approve execution
curl -s -k -X POST "https://localhost/webhook/fortigate-ai" \
  -H "Content-Type: application/json" \
  -H "Host: n8nsso.inlumi.education" \
  -d '{"message": "yes", "sessionId": "test-1"}'
```

**Supported commands:** firewall policies, interfaces, routes, system status, HA status, address objects, VIPs, VPN tunnels

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
