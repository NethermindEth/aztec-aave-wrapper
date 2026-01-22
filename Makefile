# ==============================================================================
# Aztec Aave Wrapper - Development Makefile
# ==============================================================================
# This Makefile provides standard development workflow commands for building,
# testing, and deploying the Aztec Aave Wrapper project.
#
# Usage:
#   make <target>
#
# Run 'make help' for a list of available targets.
# ==============================================================================

# Configuration
SHELL := /bin/bash
.DEFAULT_GOAL := help

# Colors for terminal output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m

# Project directories
L1_DIR := eth
L2_DIR := aztec
E2E_DIR := e2e

# Aztec local network configuration
# Uses `aztec start --local-network` which manages both L1 and L2 internally
AZTEC_PID_FILE := .aztec.pid
AZTEC_LOG_FILE := .aztec.log
AUTOMINE_PID_FILE := .automine.pid
AUTOMINE_LOG_FILE := .automine.log

# Network ports
export ANVIL_L1_PORT ?= 8545
export PXE_PORT ?= 8080

# ==============================================================================
# PHONY Targets Declaration
# ==============================================================================
.PHONY: help check-tooling check-tool-docker check-tool-foundry check-tool-bun \
        check-tool-aztec check-tool-aztec devnet-up devnet-down devnet-health \
        devnet-logs automine-logs advance-blocks build build-l1 build-l2 test test-l1 test-l2 \
        deploy-local e2e clean

# ==============================================================================
# Help
# ==============================================================================

## help: Show this help message
help:
	@echo ""
	@echo "Aztec Aave Wrapper - Development Commands"
	@echo "=========================================="
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Tooling:"
	@grep -E '^## check' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""
	@echo "Devnet:"
	@grep -E '^## devnet|^## automine|^## advance' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""
	@echo "Build:"
	@grep -E '^## build' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""
	@echo "Test:"
	@grep -E '^## test|^## e2e' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""
	@echo "Deploy:"
	@grep -E '^## deploy' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""
	@echo "Maintenance:"
	@grep -E '^## clean' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
	@echo ""

# ==============================================================================
# Tooling Checks
# ==============================================================================

## check-tooling: Verify all required development tools are installed
check-tooling:
	@echo ""
	@echo "Checking required development tools..."
	@echo "======================================="
	@echo ""
	@MISSING_TOOLS="" ; \
	OPTIONAL_MISSING="" ; \
	\
	echo "Required Tools:" ; \
	echo "---------------" ; \
	\
	if command -v docker >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) docker: $$(docker --version | head -1)" ; \
		if docker compose version >/dev/null 2>&1; then \
			echo -e "$(GREEN)✓$(NC) docker compose: $$(docker compose version --short)" ; \
		else \
			echo -e "$(RED)✗$(NC) docker compose: NOT FOUND" ; \
			MISSING_TOOLS="$$MISSING_TOOLS docker-compose" ; \
		fi ; \
	else \
		echo -e "$(RED)✗$(NC) docker: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS docker" ; \
	fi ; \
	\
	if command -v forge >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) forge: $$(forge --version | head -1)" ; \
	else \
		echo -e "$(RED)✗$(NC) forge: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS forge" ; \
	fi ; \
	\
	if command -v cast >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) cast: $$(cast --version | head -1)" ; \
	else \
		echo -e "$(RED)✗$(NC) cast: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS cast" ; \
	fi ; \
	\
	if command -v anvil >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) anvil: $$(anvil --version | head -1)" ; \
	else \
		echo -e "$(RED)✗$(NC) anvil: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS anvil" ; \
	fi ; \
	\
	if command -v bun >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) bun: $$(bun --version)" ; \
	else \
		echo -e "$(RED)✗$(NC) bun: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS bun" ; \
	fi ; \
	\
	if command -v aztec >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) aztec: $$(aztec --version)" ; \
	else \
		echo -e "$(RED)✗$(NC) aztec: NOT FOUND" ; \
		MISSING_TOOLS="$$MISSING_TOOLS aztec" ; \
	fi ; \
	\
	echo "" ; \
	echo "Optional Tools:" ; \
	echo "---------------" ; \
	\
	if command -v aztec >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) aztec: $$(aztec --version 2>/dev/null || echo 'installed')" ; \
	else \
		echo -e "$(YELLOW)○$(NC) aztec: NOT FOUND (optional - sandbox runs in Docker)" ; \
		OPTIONAL_MISSING="$$OPTIONAL_MISSING aztec" ; \
	fi ; \
	\
	if command -v node >/dev/null 2>&1; then \
		echo -e "$(GREEN)✓$(NC) node: $$(node --version)" ; \
	else \
		echo -e "$(YELLOW)○$(NC) node: NOT FOUND (optional - bun handles JS/TS)" ; \
		OPTIONAL_MISSING="$$OPTIONAL_MISSING node" ; \
	fi ; \
	\
	echo "" ; \
	echo "=======================================" ; \
	\
	if [ -n "$$MISSING_TOOLS" ]; then \
		echo -e "$(RED)Missing required tools:$$MISSING_TOOLS$(NC)" ; \
		echo "" ; \
		echo "Installation instructions:" ; \
		echo "  docker:  https://docs.docker.com/get-docker/" ; \
		echo "  foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup" ; \
		echo "  bun:     curl -fsSL https://bun.sh/install | bash" ; \
		echo "  aztec:   curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup" ; \
		echo "" ; \
		exit 1 ; \
	else \
		echo -e "$(GREEN)All required tools are installed!$(NC)" ; \
		if [ -n "$$OPTIONAL_MISSING" ]; then \
			echo -e "$(YELLOW)Some optional tools are missing:$$OPTIONAL_MISSING$(NC)" ; \
		fi ; \
		echo "" ; \
	fi

# ==============================================================================
# Devnet Management
# ==============================================================================

## devnet-up: Start local development network and deploy contracts
devnet-up:
	@echo ""
	@echo "Starting local devnet..."
	@echo "========================"
	@echo ""
	@if [ -f $(AZTEC_PID_FILE) ] && kill -0 $$(cat $(AZTEC_PID_FILE)) 2>/dev/null; then \
		echo -e "$(YELLOW)Devnet already running (PID: $$(cat $(AZTEC_PID_FILE)))$(NC)"; \
		echo "Run 'make devnet-down' first to stop it."; \
		exit 1; \
	fi
	@# Check for stopped containers that can be resumed
	@STOPPED_CONTAINERS=$$(docker ps -aq --filter "name=aztec-start" --filter "status=exited" 2>/dev/null); \
	if [ -n "$$STOPPED_CONTAINERS" ]; then \
		echo "Resuming stopped devnet containers (preserving blockchain state)..."; \
		echo ""; \
		docker start $$STOPPED_CONTAINERS; \
		echo ""; \
		echo "Endpoints:"; \
		echo "  - L1 Anvil:    http://localhost:$(ANVIL_L1_PORT)"; \
		echo "  - L2 PXE:      http://localhost:$(PXE_PORT)"; \
		echo ""; \
		echo "Waiting for services to be healthy..."; \
		./scripts/wait-for-services.sh; \
		echo ""; \
		echo "Starting automine (advances blocks every 5s)..."; \
		nohup bun run $(E2E_DIR)/scripts/automine.ts > $(AUTOMINE_LOG_FILE) 2>&1 & echo $$! > $(AUTOMINE_PID_FILE); \
		echo "Started automine (PID: $$(cat $(AUTOMINE_PID_FILE)))"; \
		echo ""; \
		echo -e "$(GREEN)Devnet resumed! Contracts already deployed.$(NC)"; \
		echo "Run 'make devnet-logs' to view logs."; \
		echo "Run 'make devnet-clean' to start fresh."; \
	else \
		echo "Starting fresh Aztec Local Network (aztec start --local-network)..."; \
		echo "This manages both L1 (Anvil) and L2 (PXE) with proper timing coordination."; \
		echo ""; \
		echo "Endpoints:"; \
		echo "  - L1 Anvil:    http://localhost:$(ANVIL_L1_PORT)"; \
		echo "  - L2 PXE:      http://localhost:$(PXE_PORT)"; \
		echo ""; \
		echo "Logs: $(AZTEC_LOG_FILE)"; \
		echo ""; \
		nohup aztec start --local-network > $(AZTEC_LOG_FILE) 2>&1 & echo $$! > $(AZTEC_PID_FILE); \
		echo "Started aztec (PID: $$(cat $(AZTEC_PID_FILE)))"; \
		echo ""; \
		echo "Waiting for services to be healthy..."; \
		./scripts/wait-for-services.sh; \
		echo ""; \
		echo "Deploying contracts..."; \
		bun run scripts/deploy-local.ts; \
		echo ""; \
		echo "Starting automine (advances blocks every 5s)..."; \
		nohup bun run $(E2E_DIR)/scripts/automine.ts > $(AUTOMINE_LOG_FILE) 2>&1 & echo $$! > $(AUTOMINE_PID_FILE); \
		echo "Started automine (PID: $$(cat $(AUTOMINE_PID_FILE)))"; \
		echo ""; \
		echo -e "$(GREEN)Devnet ready with contracts deployed!$(NC)"; \
		echo "Run 'make devnet-logs' to view logs."; \
		echo "Run 'make automine-logs' to view automine logs."; \
	fi
	@echo ""

## devnet-down: Stop local development network (preserves state for restart)
devnet-down:
	@echo ""
	@echo "Stopping local devnet (preserving state)..."
	@echo ""
	@# Stop automine process
	@if [ -f $(AUTOMINE_PID_FILE) ]; then \
		PID=$$(cat $(AUTOMINE_PID_FILE)); \
		kill $$PID 2>/dev/null || true; \
		rm -f $(AUTOMINE_PID_FILE); \
		echo "Stopped automine"; \
	fi
	@# Stop aztec Docker containers (don't remove - preserves blockchain state)
	@docker ps -q --filter "name=aztec-start" | xargs -r docker stop 2>/dev/null || true
	@# Kill the aztec CLI wrapper processes
	@if [ -f $(AZTEC_PID_FILE) ]; then \
		PID=$$(cat $(AZTEC_PID_FILE)); \
		kill $$PID 2>/dev/null || true; \
		rm -f $(AZTEC_PID_FILE); \
	fi
	@pkill -f "aztec-run" 2>/dev/null || true
	@pkill -f "aztec start" 2>/dev/null || true
	@echo ""
	@echo -e "$(GREEN)Devnet stopped.$(NC)"
	@echo ""

## devnet-health: Check health status of all devnet services
devnet-health:
	@./scripts/wait-for-services.sh

## devnet-logs: View logs from local devnet
devnet-logs:
	@if [ -f $(AZTEC_LOG_FILE) ]; then \
		tail -f $(AZTEC_LOG_FILE); \
	else \
		echo "No log file found. Is devnet running?"; \
		exit 1; \
	fi

## automine-logs: View logs from automine process
automine-logs:
	@if [ -f $(AUTOMINE_LOG_FILE) ]; then \
		tail -f $(AUTOMINE_LOG_FILE); \
	else \
		echo "No automine log file found. Is devnet running?"; \
		exit 1; \
	fi

## devnet-restart: Restart the local development network
devnet-restart: devnet-down devnet-up

## advance-blocks: Advance Aztec L2 blocks (default: 2, or pass N=<num>)
advance-blocks: check-devnet-running
	@echo ""
	@echo "Advancing Aztec blocks..."
	@echo "========================="
	cd $(E2E_DIR) && bun run scripts/advance-blocks.ts $(or $(N),2)
	@echo ""

## devnet-clean: Stop devnet and remove all data/containers (full reset)
devnet-clean:
	@echo ""
	@echo "Stopping devnet and removing all data..."
	@echo ""
	@$(MAKE) devnet-down
	@# Remove containers (allows fresh start)
	@docker ps -aq --filter "name=aztec-start" | xargs -r docker rm 2>/dev/null || true
	@rm -f $(AZTEC_LOG_FILE) $(AZTEC_PID_FILE)
	@rm -f $(AUTOMINE_LOG_FILE) $(AUTOMINE_PID_FILE)
	@rm -f .deployments.local.json
	@rm -rf /tmp/aztec-world-state-*
	@echo ""
	@echo -e "$(GREEN)Devnet cleaned. Next 'make devnet-up' will start fresh.$(NC)"
	@echo ""

# ==============================================================================
# Build Targets
# ==============================================================================

## build: Build all contracts (L1, L2)
build: build-l1 build-l2
	@echo ""
	@echo -e "$(GREEN)All contracts built successfully!$(NC)"
	@echo ""

## build-l1: Build L1 Solidity contracts (Portal)
build-l1:
	@echo ""
	@echo "Building L1 contracts..."
	@echo "========================"
	cd $(L1_DIR) && forge build
	@echo ""

## build-l2: Build L2 Noir contracts (Aztec)
build-l2:
	@echo ""
	@echo "Building L2 contracts..."
	@echo "========================"
	cd $(L2_DIR) && aztec compile
	@echo ""

# ==============================================================================
# Test Targets
# ==============================================================================

## test: Run all unit tests
test: test-l1 test-l2
	@echo ""
	@echo -e "$(GREEN)All tests passed!$(NC)"
	@echo ""

## test-l1: Run L1 contract tests
test-l1:
	@echo ""
	@echo "Running L1 contract tests..."
	@echo "============================"
	cd $(L1_DIR) && forge test -vv
	@echo ""

## test-l2: Run L2 contract tests
test-l2:
	@echo ""
	@echo "Running L2 contract tests..."
	@echo "============================"
	cd $(L2_DIR) && aztec test
	@echo ""

# ==============================================================================
# Deploy Targets
# ==============================================================================

## deploy-local: Deploy all contracts to local devnet
deploy-local: check-devnet-running
	@echo ""
	@echo "Deploying contracts to local devnet..."
	@echo "======================================="
	@echo ""
	bun run scripts/deploy-local.ts
	@echo ""
	@echo -e "$(GREEN)Local deployment complete!$(NC)"
	@echo ""
	@echo "Deployment addresses saved to .deployments.local.json"
	@echo ""

# Internal target to check if devnet is running
check-devnet-running:
	@echo "Checking if devnet is running..."
	@curl -sf http://localhost:$(ANVIL_L1_PORT) -X POST \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
		>/dev/null 2>&1 || \
		(echo -e "$(RED)Error: Devnet is not running. Start it with 'make devnet-up'$(NC)" && exit 1)
	@echo "Devnet is running."

# ==============================================================================
# End-to-End Tests
# ==============================================================================

## e2e: Run end-to-end tests (requires running devnet)
e2e: check-devnet-running
	@echo ""
	@echo "Running end-to-end tests..."
	@echo "==========================="
	@echo ""
	cd $(E2E_DIR) && bun run test
	@echo ""

## e2e-watch: Run end-to-end tests in watch mode
e2e-watch: check-devnet-running
	cd $(E2E_DIR) && bun run test:watch

# ==============================================================================
# Maintenance
# ==============================================================================

## clean: Clean all build artifacts
clean:
	@echo ""
	@echo "Cleaning build artifacts..."
	@echo "==========================="
	@echo ""
	@echo "Cleaning L1 artifacts..."
	cd $(L1_DIR) && forge clean 2>/dev/null || true
	@echo "Cleaning L2 artifacts..."
	rm -rf $(L2_DIR)/target 2>/dev/null || true
	@echo "Cleaning node_modules caches..."
	rm -rf $(E2E_DIR)/node_modules/.cache 2>/dev/null || true
	@echo ""
	@echo -e "$(GREEN)Clean complete!$(NC)"
	@echo ""

## install: Install all dependencies
install:
	@echo ""
	@echo "Installing dependencies..."
	@echo "=========================="
	@echo ""
	bun install
	@echo ""
	@echo "Installing L1 Foundry dependencies..."
	cd $(L1_DIR) && forge install
	@echo ""
	@echo -e "$(GREEN)All dependencies installed!$(NC)"
	@echo ""

## fmt: Format all code
fmt:
	@echo ""
	@echo "Formatting code..."
	@echo "=================="
	@echo ""
	cd $(L1_DIR) && forge fmt
	cd $(L2_DIR) && aztec fmt
	@echo ""
	@echo -e "$(GREEN)Formatting complete!$(NC)"
	@echo ""

## lint: Lint all code
lint:
	@echo ""
	@echo "Linting code..."
	@echo "==============="
	@echo ""
	cd $(L1_DIR) && forge fmt --check
	@echo ""
