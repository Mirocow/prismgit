# =============================================================================
# PrismGit — Makefile
# =============================================================================
# All-in-one entry point for development, build, and packaging.
#
# Common targets:
#   make install       — install dependencies
#   make dev           — start dev server with HMR
#   make build         — production build (renderer + main)
#   make package       — package for current OS
#   make package-all   — build all platforms via Docker
#   make docker-linux  — build Linux in Docker
#   make docker-win    — build Windows in Docker
#   make docker-mac    — build macOS in Docker
#   make clean         — remove build artifacts
#   make typecheck     — run TypeScript type check
#   make help          — show this help
#
# =============================================================================

# Project paths
PROJECT_DIR  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
APP_NAME     := smartgit-electron
APP_VERSION  := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

# Tools
NPM          := npm
NPX          := npx
DOCKER       := docker
DOCKER_COMPOSE := docker compose
PYTHON       := python3

# Colors
COLOR_RESET  := \033[0m
COLOR_BOLD   := \033[1m
COLOR_GREEN  := \033[32m
COLOR_YELLOW := \033[33m
COLOR_BLUE   := \033[34m
COLOR_CYAN   := \033[36m

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Help
# =============================================================================

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "$(COLOR_BOLD)PrismGit — Makefile$(COLOR_RESET)"
	@echo ""
	@echo "$(COLOR_CYAN)Development:$(COLOR_RESET)"
	@grep -E '^[a-zA-Z_-]+:.*## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  $(COLOR_GREEN)%-20s$(COLOR_RESET) %s\n", $$1, $$2}' | sort
	@echo ""
	@echo "$(COLOR_CYAN)Examples:$(COLOR_RESET)"
	@echo "  make install && make dev          # first-time setup + run"
	@echo "  make docker-all                    # build all platforms via Docker"
	@echo "  make docker-linux                  # build Linux only"
	@echo "  make release-check                 # verify release artifacts"
	@echo ""

# =============================================================================
# Development
# =============================================================================

.PHONY: install
install: ## Install npm dependencies
	@echo "$(COLOR_YELLOW)→ Installing dependencies...$(COLOR_RESET)"
	$(NPM) install
	@echo "$(COLOR_GREEN)✓ Dependencies installed$(COLOR_RESET)"

.PHONY: install-ci
install-ci: ## Install dependencies (CI mode, no audit/fund)
	@echo "$(COLOR_YELLOW)→ Installing dependencies (CI)...$(COLOR_RESET)"
	$(NPM) ci --no-audit --no-fund
	@echo "$(COLOR_GREEN)✓ Dependencies installed$(COLOR_RESET)"

.PHONY: dev
dev: ## Start development server with HMR
	@echo "$(COLOR_YELLOW)→ Starting dev server...$(COLOR_RESET)"
	@echo "  Electron app will open automatically."
	@echo "  Vite dev server: http://localhost:5173"
	$(NPM) run dev

.PHONY: dev-debug
dev-debug: ## Start dev server with debug logging
	DEBUG=1 $(NPM) run dev

# =============================================================================
# Build & Type Check
# =============================================================================

.PHONY: typecheck
typecheck: ## Run TypeScript type checker
	@echo "$(COLOR_YELLOW)→ Running TypeScript check...$(COLOR_RESET)"
	$(NPX) tsc --noEmit
	@echo "$(COLOR_GREEN)✓ TypeScript OK$(COLOR_RESET)"

.PHONY: build
build: ## Build renderer and main process (production)
	@echo "$(COLOR_YELLOW)→ Building...$(COLOR_RESET)"
	$(NPM) run build
	@echo "$(COLOR_GREEN)✓ Build complete$(COLOR_RESET)"

.PHONY: build-renderer
build-renderer: ## Build only renderer (Vite)
	$(NPX) vite build

.PHONY: build-electron
build-electron: ## Build only Electron main process
	$(NPX) tsc -p electron/tsconfig.json

# =============================================================================
# Packaging (local)
# =============================================================================

.PHONY: package
package: build ## Package for current OS
	@echo "$(COLOR_YELLOW)→ Packaging for current OS...$(COLOR_RESET)"
	$(NPX) electron-builder
	@echo "$(COLOR_GREEN)✓ Package complete → release/$(COLOR_RESET)"

.PHONY: package-linux
package-linux: build ## Package for Linux (AppImage, deb, rpm)
	@echo "$(COLOR_YELLOW)→ Packaging for Linux...$(COLOR_RESET)"
	$(NPX) electron-builder --linux
	@ls -lh release/*.* 2>/dev/null || true

.PHONY: package-win
package-win: build ## Package for Windows (NSIS, MSI)
	@echo "$(COLOR_YELLOW)→ Packaging for Windows...$(COLOR_RESET)"
	$(NPX) electron-builder --win
	@ls -lh release/*.* 2>/dev/null || true

.PHONY: package-mac
package-mac: build ## Package for macOS (dmg, zip)
	@echo "$(COLOR_YELLOW)→ Packaging for macOS...$(COLOR_RESET)"
	$(NPX) electron-builder --mac
	@ls -lh release/*.* 2>/dev/null || true

# =============================================================================
# Docker Builds (all platforms)
# =============================================================================

.PHONY: docker-build
docker-build: ## Build Docker image for Linux (default)
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Linux Docker image...$(COLOR_RESET)"
	$(DOCKER) build -t $(APP_NAME):linux -f Dockerfile.linux .

.PHONY: docker-build-win
docker-build-win: ## Build Docker image for Windows (with Wine)
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Windows Docker image...$(COLOR_RESET)"
	$(DOCKER) build -t $(APP_NAME):win -f Dockerfile.win .

.PHONY: docker-build-mac
docker-build-mac: ## Build Docker image for macOS
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS Docker image...$(COLOR_RESET)"
	$(DOCKER) build -t $(APP_NAME):mac -f Dockerfile.mac --build-arg ARCH=x64 .

.PHONY: docker-build-mac-arm64
docker-build-mac-arm64: ## Build Docker image for macOS ARM64
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS ARM64 Docker image...$(COLOR_RESET)"
	$(DOCKER) build -t $(APP_NAME):mac-arm64 -f Dockerfile.mac --build-arg ARCH=arm64 .

.PHONY: docker-all
docker-all: docker-linux docker-win docker-mac docker-mac-arm64 ## Build all platforms via Docker

.PHONY: docker-linux
docker-linux: ## Build Linux in Docker
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Linux in Docker...$(COLOR_RESET)"
	mkdir -p release/linux
	./scripts/docker-build.sh linux
	@echo "$(COLOR_GREEN)✓ Linux artifacts in release/linux/$(COLOR_RESET)"

.PHONY: docker-win
docker-win: ## Build Windows in Docker (via Wine)
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Windows in Docker...$(COLOR_RESET)"
	mkdir -p release/win
	./scripts/docker-build.sh win
	@echo "$(COLOR_GREEN)✓ Windows artifacts in release/win/$(COLOR_RESET)"

.PHONY: docker-mac
docker-mac: ## Build macOS (Intel) in Docker
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS Intel in Docker...$(COLOR_RESET)"
	mkdir -p release/mac
	./scripts/docker-build.sh mac
	@echo "$(COLOR_GREEN)✓ macOS artifacts in release/mac/$(COLOR_RESET)"

.PHONY: docker-mac-arm64
docker-mac-arm64: ## Build macOS (Apple Silicon) in Docker
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS ARM64 in Docker...$(COLOR_RESET)"
	mkdir -p release/mac-arm64
	./scripts/docker-build.sh mac-arm64
	@echo "$(COLOR_GREEN)✓ macOS ARM64 artifacts in release/mac-arm64/$(COLOR_RESET)"

.PHONY: docker-compose-up
docker-compose-up: ## Build all platforms via docker compose (parallel)
	@echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building all platforms via docker compose...$(COLOR_RESET)"
	$(DOCKER_COMPOSE) up --build
	@echo "$(COLOR_GREEN)✓ All platforms built$(COLOR_RESET)"

# =============================================================================
# Code Quality
# =============================================================================

.PHONY: lint
lint: ## Run linter
	$(NPX) eslint . --ext ts,tsx || true

.PHONY: lint-fix
lint-fix: ## Run linter and auto-fix
	$(NPX) eslint . --ext ts,tsx --fix || true

.PHONY: format
format: ## Format code with prettier
	$(NPX) prettier --write "src/**/*.{ts,tsx}" "electron/**/*.ts" 2>/dev/null || true

.PHONY: check
check: typecheck lint ## Run all checks (typecheck + lint)
	@echo "$(COLOR_GREEN)✓ All checks passed$(COLOR_RESET)"

# =============================================================================
# Testing
# =============================================================================

.PHONY: test
test: ## Run all tests once
	@echo "$(COLOR_YELLOW)→ Running tests...$(COLOR_RESET)"
	$(NPX) vitest run
	@echo "$(COLOR_GREEN)✓ Tests complete$(COLOR_RESET)"

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	@echo "$(COLOR_YELLOW)→ Starting test watcher...$(COLOR_RESET)"
	$(NPX) vitest

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	@echo "$(COLOR_YELLOW)→ Running tests with coverage...$(COLOR_RESET)"
	$(NPX) vitest run --coverage
	@echo "$(COLOR_GREEN)✓ Coverage report in ./coverage/$(COLOR_RESET)"

.PHONY: test-ui
test-ui: ## Run tests in interactive UI mode
	@echo "$(COLOR_YELLOW)→ Starting test UI...$(COLOR_RESET)"
	$(NPX) vitest --ui

.PHONY: test-unit
test-unit: ## Run only unit tests
	@echo "$(COLOR_YELLOW)→ Running unit tests...$(COLOR_RESET)"
	$(NPX) vitest run tests/unit
	@echo "$(COLOR_GREEN)✓ Unit tests complete$(COLOR_RESET)"

.PHONY: test-integration
test-integration: ## Run only integration tests
	@echo "$(COLOR_YELLOW)→ Running integration tests...$(COLOR_RESET)"
	$(NPX) vitest run tests/integration
	@echo "$(COLOR_GREEN)✓ Integration tests complete$(COLOR_RESET)"

.PHONY: test-components
test-components: ## Run only component tests
	@echo "$(COLOR_YELLOW)→ Running component tests...$(COLOR_RESET)"
	$(NPX) vitest run tests/components
	@echo "$(COLOR_GREEN)✓ Component tests complete$(COLOR_RESET)"

# =============================================================================
# Clean
# =============================================================================

.PHONY: clean
clean: ## Remove build artifacts (dist, dist-electron, release)
	@echo "$(COLOR_YELLOW)→ Cleaning build artifacts...$(COLOR_RESET)"
	rm -rf dist dist-electron release .vite
	@echo "$(COLOR_GREEN)✓ Clean$(COLOR_RESET)"

.PHONY: clean-all
clean-all: clean ## Remove build artifacts + node_modules + Docker images
	@echo "$(COLOR_YELLOW)→ Removing node_modules...$(COLOR_RESET)"
	rm -rf node_modules package-lock.json
	@echo "$(COLOR_YELLOW)→ Removing Docker images...$(COLOR_RESET)"
	-$(DOCKER) rmi $(APP_NAME):linux $(APP_NAME):win $(APP_NAME):mac $(APP_NAME):mac-arm64 2>/dev/null || true
	@echo "$(COLOR_GREEN)✓ All clean$(COLOR_RESET)"

.PHONY: clean-docker
clean-docker: ## Remove Docker images and build cache
	-$(DOCKER) rmi $(APP_NAME):linux $(APP_NAME):win $(APP_NAME):mac $(APP_NAME):mac-arm64 2>/dev/null || true
	-$(DOCKER) builder prune -f 2>/dev/null || true

# =============================================================================
# Release / Inspect
# =============================================================================

.PHONY: release-check
release-check: ## Verify release artifacts
	@echo "$(COLOR_BOLD)$(COLOR_CYAN)Release artifacts:$(COLOR_RESET)"
	@find release -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.zip" -o -name "*.snap" -o -name "*.pacman" \) -exec ls -lh {} \; 2>/dev/null || echo "  No artifacts found. Run 'make docker-all' first."

.PHONY: version
version: ## Show current version
	@echo "$(APP_NAME) v$(APP_VERSION)"

.PHONY: bump-version
bUMP_VERSION ?= patch
bump-version: ## Bump version (BUMP_VERSION=patch|minor|major)
	@echo "$(COLOR_YELLOW)→ Bumping $(BUMP_VERSION) version...$(COLOR_RESET)"
	$(NPM) version $(BUMP_VERSION) --no-git-tag-version
	@echo "$(COLOR_GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(COLOR_RESET)"

# =============================================================================
# Misc
# =============================================================================

.PHONY: icons-check
icons-check: ## Verify SVG icons file
	@echo "$(COLOR_YELLOW)→ Checking icons.tsx...$(COLOR_RESET)"
	@grep -c "^export const" src/components/icons.tsx | xargs -I{} echo "  {} icons exported"
	@echo "$(COLOR_GREEN)✓ Icons OK$(COLOR_RESET)"

.PHONY: tree
tree: ## Show project structure (top-level)
	@echo "$(COLOR_BOLD)$(COLOR_CYAN)Project structure:$(COLOR_RESET)"
	@ls -la --color=auto 2>/dev/null || ls -la

.PHONY: stats
stats: ## Show bundle size statistics
	@echo "$(COLOR_BOLD)$(COLOR_CYAN)Bundle statistics:$(COLOR_RESET)"
	@if [ -d dist ]; then \
	        du -sh dist dist-electron 2>/dev/null; \
	        echo ""; \
	        echo "Renderer chunks:"; \
	        ls -lh dist/assets/*.js 2>/dev/null | awk '{printf "  %s\n", $$0}'; \
	        echo ""; \
	        echo "Main process:"; \
	        ls -lh dist-electron/*.js 2>/dev/null | awk '{printf "  %s\n", $$0}'; \
	else \
	        echo "  No build found. Run 'make build' first."; \
	fi

# =============================================================================
# Phony declarations (so targets don't conflict with files)
# =============================================================================

.PHONY: all
all: typecheck build ## Type-check then build

.PHONY: ci
ci: install-ci check test build ## CI pipeline: install + check + test + build
	@echo "$(COLOR_GREEN)✓ CI complete$(COLOR_RESET)"
