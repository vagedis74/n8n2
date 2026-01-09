#!/bin/bash

# n8n Enterprise Instance Stop Script
# ====================================

cd "$(dirname "$0")"

# Determine which docker compose command to use
if docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

echo "Stopping n8n Enterprise services..."
$DOCKER_COMPOSE down

echo ""
echo "Services stopped."
echo ""
echo "To remove all data (volumes), run:"
echo "  $DOCKER_COMPOSE down -v"
