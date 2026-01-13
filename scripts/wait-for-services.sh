#!/usr/bin/env bash
# =============================================================================
# wait-for-services.sh - Health check script for Aztec Aave Wrapper devnet
#
# Waits for all services to be healthy before returning.
# Exit codes:
#   0 - All services are healthy
#   1 - Timeout waiting for services
#   2 - Docker is not running or docker compose not available
# =============================================================================

set -euo pipefail

# Configuration
TIMEOUT=${TIMEOUT:-300}  # 5 minutes default timeout
POLL_INTERVAL=${POLL_INTERVAL:-5}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Service configuration
ANVIL_L1_PORT=${ANVIL_L1_PORT:-8545}
PXE_PORT=${PXE_PORT:-8081}

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if Docker is running
check_docker() {
    if ! command_exists docker; then
        log_error "Docker is not installed"
        exit 2
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running"
        exit 2
    fi

    if ! command_exists "docker" || ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose is not available"
        exit 2
    fi
}

# Check if anvil L1 is healthy
check_anvil_l1() {
    local response
    response=$(curl -s -X POST "http://localhost:${ANVIL_L1_PORT}" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null || echo "")

    if echo "$response" | grep -q '"result"'; then
        return 0
    fi
    return 1
}

# Check if PXE is healthy
check_pxe() {
    local response
    response=$(curl -s "http://localhost:${PXE_PORT}/status" 2>/dev/null || echo "")

    # PXE returns "OK" or JSON with status info when healthy
    if [ -n "$response" ] && echo "$response" | grep -q -i -E '(version|nodInfo|ok)'; then
        return 0
    fi

    # Alternative check - try to get node info
    response=$(curl -s -X POST "http://localhost:${PXE_PORT}" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"pxe_getNodeInfo","params":[],"id":1}' 2>/dev/null || echo "")

    if echo "$response" | grep -q '"result"'; then
        return 0
    fi
    return 1
}

# Wait for a service with timeout
wait_for_service() {
    local service_name="$1"
    local check_function="$2"
    local elapsed=0

    log_info "Waiting for $service_name..."

    while [ $elapsed -lt $TIMEOUT ]; do
        if $check_function; then
            log_success "$service_name is healthy"
            return 0
        fi

        sleep $POLL_INTERVAL
        elapsed=$((elapsed + POLL_INTERVAL))

        # Show progress every 30 seconds
        if [ $((elapsed % 30)) -eq 0 ]; then
            log_warning "$service_name not ready yet (${elapsed}s/${TIMEOUT}s)"
        fi
    done

    log_error "$service_name failed to become healthy within ${TIMEOUT}s"
    return 1
}

# =============================================================================
# Main Script
# =============================================================================

main() {
    echo ""
    echo "=========================================="
    echo " Aztec Aave Wrapper - Service Health Check"
    echo "=========================================="
    echo ""

    # Check prerequisites
    log_info "Checking prerequisites..."
    check_docker
    log_success "Docker is running"

    # Change to project directory for docker compose commands
    cd "$PROJECT_DIR"

    # Check if services are running
    log_info "Checking if services are started..."
    if ! docker compose ps --format json 2>/dev/null | grep -q "running"; then
        log_warning "Services may not be running. Checking individual containers..."
    fi

    echo ""
    log_info "Starting health checks (timeout: ${TIMEOUT}s)"
    echo ""

    # Track overall status
    all_healthy=true

    # Check Anvil L1
    if ! wait_for_service "Anvil L1 (port ${ANVIL_L1_PORT})" check_anvil_l1; then
        all_healthy=false
    fi

    # Check PXE (Aztec Sandbox)
    if ! wait_for_service "PXE/Aztec Sandbox (port ${PXE_PORT})" check_pxe; then
        all_healthy=false
    fi

    echo ""
    echo "=========================================="

    if $all_healthy; then
        log_success "All services are healthy!"
        echo ""
        echo "Service endpoints:"
        echo "  - Anvil L1: http://localhost:${ANVIL_L1_PORT}"
        echo "  - PXE:      http://localhost:${PXE_PORT}"
        echo ""
        exit 0
    else
        log_error "Some services failed health checks"
        echo ""
        echo "Troubleshooting:"
        echo "  1. Check Docker logs: docker compose logs"
        echo "  2. Restart services:  docker compose down && docker compose up -d"
        echo "  3. Check port conflicts: lsof -i :8545 -i :8080"
        echo ""
        exit 1
    fi
}

# Run main function
main "$@"
