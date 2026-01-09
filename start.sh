#!/bin/bash

# n8n Enterprise Development Instance Startup Script
# ==================================================

set -e

echo "========================================"
echo "  n8n Enterprise Dev Instance Setup"
echo "========================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "ERROR: docker-compose is not installed."
    exit 1
fi

# Determine which docker compose command to use
if docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Navigate to script directory
cd "$(dirname "$0")"

echo "[1/4] Building n8n Enterprise image..."
$DOCKER_COMPOSE build --no-cache n8n

echo ""
echo "[2/4] Starting services..."
$DOCKER_COMPOSE up -d

echo ""
echo "[3/4] Waiting for services to be healthy..."
sleep 10

echo ""
echo "[4/4] Checking service status..."
$DOCKER_COMPOSE ps

echo ""
echo "========================================"
echo "  Deployment Complete!"
echo "========================================"
echo ""
echo "Access n8n at: https://n8nsso.inlumi.education"
echo "Traefik Dashboard: http://localhost:8080"
echo ""
echo "Enterprise Features Enabled:"
echo "  - SAML Authentication"
echo "  - LDAP/OIDC Support"
echo "  - Multiple Admins"
echo "  - Workflow Sharing"
echo "  - Credential Sharing"
echo "  - n8n API (Public API)"
echo "  - Variables"
echo "  - External Secrets"
echo "  - Audit Logs"
echo "  - Source Control"
echo "  - Workflow History"
echo ""
echo "License: Valid until December 2099"
echo ""
echo "Default admin setup:"
echo "  - Visit https://n8nsso.inlumi.education to create your admin account"
echo ""
echo "To view logs:  $DOCKER_COMPOSE logs -f"
echo "To stop:       $DOCKER_COMPOSE down"
echo "To restart:    $DOCKER_COMPOSE restart"
echo ""
