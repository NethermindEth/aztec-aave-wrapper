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

# Docker compose configuration
DOCKER_COMPOSE := docker compose
DOCKER_COMPOSE_FILE := docker-compose.yml

# Anvil ports (from docker-compose.yml defaults)
ANVIL_L1_PORT ?= 8545
PXE_PORT ?= 8080

# ==============================================================================
# PHONY Targets Declaration
# ==============================================================================
.PHONY: help check-tooling check-tool-docker check-tool-foundry check-tool-bun \
        check-tool-aztec check-tool-aztec devnet-up devnet-down devnet-health \
        devnet-logs build build-l1 build-l2 test test-l1 test-l2 \
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
	@grep -E '^## devnet' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/:/: /'
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

## devnet-up: Start local development network (Anvil L1, Aztec Sandbox)
devnet-up:
	@echo ""
	@echo "Starting local devnet..."
	@echo "========================"
	@echo ""
	@echo "Services:"
	@echo "  - Anvil L1 (Ethereum):    http://localhost:$(ANVIL_L1_PORT)"
	@echo "  - Aztec Sandbox (PXE):    http://localhost:$(PXE_PORT)"
	@echo ""
	$(DOCKER_COMPOSE) -f $(DOCKER_COMPOSE_FILE) up -d
	@echo ""
	@echo "Devnet started. Run 'make devnet-health' to check status."
	@echo "Run 'make devnet-logs' to view logs."
	@echo ""

## devnet-down: Stop local development network
devnet-down:
	@echo ""
	@echo "Stopping local devnet..."
	@echo ""
	$(DOCKER_COMPOSE) -f $(DOCKER_COMPOSE_FILE) down
	@echo ""
	@echo "Devnet stopped."
	@echo ""

## devnet-health: Check health status of all devnet services
devnet-health:
	@./scripts/wait-for-services.sh

## devnet-logs: View logs from all devnet services
devnet-logs:
	$(DOCKER_COMPOSE) -f $(DOCKER_COMPOSE_FILE) logs -f

## devnet-restart: Restart the local development network
devnet-restart: devnet-down devnet-up

## devnet-clean: Stop devnet and remove all volumes/data
devnet-clean:
	@echo ""
	@echo "Stopping devnet and removing all data..."
	@echo ""
	$(DOCKER_COMPOSE) -f $(DOCKER_COMPOSE_FILE) down -v --remove-orphans
	@echo ""
	@echo "Devnet cleaned."
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
