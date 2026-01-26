#!/bin/bash
# n8n API Helper Script
# Usage: ./n8n-api.sh <command> [options]

set -e

# Configuration
N8N_HOST="n8nsso.inlumi.education"
N8N_API_URL="https://localhost/api/v1"
N8N_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjMDhmNGJlNC1jNzEyLTRkMzYtYTVkNy1iYTc2ZTVkZTQxNDYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY3OTY5NzYxfQ.ItWhMpa2ndWg9avJmfKEzY1lLzXb8IMqoD-FmSOYPsg"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# API request function
api_request() {
    local method="${1:-GET}"
    local endpoint="$2"
    local data="$3"

    if [ -n "$data" ]; then
        curl -sk -X "$method" "${N8N_API_URL}${endpoint}" \
            -H "Host: ${N8N_HOST}" \
            -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -sk -X "$method" "${N8N_API_URL}${endpoint}" \
            -H "Host: ${N8N_HOST}" \
            -H "X-N8N-API-KEY: ${N8N_API_KEY}"
    fi
}

# Commands
cmd_workflows() {
    echo -e "${GREEN}Listing workflows...${NC}"
    api_request GET "/workflows" | jq -r '.data[] | "\(.active | if . then "✓" else "✗" end) \(.id)\t\(.name)"' | column -t -s $'\t'
}

cmd_workflow() {
    local id="$1"
    if [ -z "$id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 workflow <id>"
        exit 1
    fi
    echo -e "${GREEN}Getting workflow ${id}...${NC}"
    api_request GET "/workflows/${id}" | jq
}

cmd_users() {
    echo -e "${GREEN}Listing users...${NC}"
    api_request GET "/users" | jq -r '.data[] | "\(.email)\t\(.firstName) \(.lastName)"' | column -t -s $'\t'
}

cmd_executions() {
    local limit="${1:-20}"
    echo -e "${GREEN}Listing last ${limit} executions...${NC}"
    api_request GET "/executions?limit=${limit}" | jq -r '.data[] | "\(.status | if . == "success" then "✓" else "✗" end) \(.id)\t\(.workflowId)\t\(.startedAt)"' | column -t -s $'\t'
}

cmd_execution() {
    local id="$1"
    if [ -z "$id" ]; then
        echo -e "${RED}Error: Execution ID required${NC}"
        echo "Usage: $0 execution <id>"
        exit 1
    fi
    echo -e "${GREEN}Getting execution ${id}...${NC}"
    api_request GET "/executions/${id}" | jq
}

cmd_activate() {
    local id="$1"
    if [ -z "$id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 activate <workflow_id>"
        exit 1
    fi
    echo -e "${GREEN}Activating workflow ${id}...${NC}"
    api_request PATCH "/workflows/${id}" '{"active": true}' | jq -r '"Workflow \(.id) active: \(.active)"'
}

cmd_deactivate() {
    local id="$1"
    if [ -z "$id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 deactivate <workflow_id>"
        exit 1
    fi
    echo -e "${GREEN}Deactivating workflow ${id}...${NC}"
    api_request PATCH "/workflows/${id}" '{"active": false}' | jq -r '"Workflow \(.id) active: \(.active)"'
}

cmd_run() {
    local id="$1"
    shift
    local data="${1:-{}}"
    if [ -z "$id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 run <workflow_id> [json_data]"
        exit 1
    fi
    echo -e "${GREEN}Running workflow ${id}...${NC}"
    api_request POST "/workflows/${id}/run" "$data" | jq
}

cmd_health() {
    echo -e "${GREEN}Checking n8n health...${NC}"
    curl -sk "https://localhost/healthz" -H "Host: ${N8N_HOST}"
    echo ""
}

cmd_raw() {
    local method="${1:-GET}"
    local endpoint="$2"
    local data="$3"
    if [ -z "$endpoint" ]; then
        echo -e "${RED}Error: Endpoint required${NC}"
        echo "Usage: $0 raw <METHOD> <endpoint> [json_data]"
        exit 1
    fi
    api_request "$method" "$endpoint" "$data" | jq
}

cmd_help() {
    echo "n8n API Helper Script"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  workflows              List all workflows"
    echo "  workflow <id>          Get workflow details"
    echo "  users                  List all users"
    echo "  executions [limit]     List executions (default: 20)"
    echo "  execution <id>         Get execution details"
    echo "  activate <id>          Activate a workflow"
    echo "  deactivate <id>        Deactivate a workflow"
    echo "  run <id> [data]        Run a workflow with optional JSON data"
    echo "  health                 Check n8n health"
    echo "  raw <METHOD> <path>    Raw API request"
    echo "  help                   Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 workflows"
    echo "  $0 workflow 5qkoAsY840zsJWV8"
    echo "  $0 executions 50"
    echo "  $0 activate 5qkoAsY840zsJWV8"
    echo "  $0 run 5qkoAsY840zsJWV8 '{\"key\": \"value\"}'"
    echo "  $0 raw GET /credentials"
}

# Main
case "${1:-help}" in
    workflows)   cmd_workflows ;;
    workflow)    cmd_workflow "$2" ;;
    users)       cmd_users ;;
    executions)  cmd_executions "$2" ;;
    execution)   cmd_execution "$2" ;;
    activate)    cmd_activate "$2" ;;
    deactivate)  cmd_deactivate "$2" ;;
    run)         cmd_run "$2" "$3" ;;
    health)      cmd_health ;;
    raw)         cmd_raw "$2" "$3" "$4" ;;
    help|--help|-h) cmd_help ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        cmd_help
        exit 1
        ;;
esac
