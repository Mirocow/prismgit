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
#   make package-mac-arm  — package macOS ARM (Apple Silicon)
#   make package-mac-x64  — package macOS Intel (x64)
#   make package-all   — build all platforms via Docker
#   make docker-linux  — build Linux in Docker
#   make docker-win    — build Windows in Docker
#   make docker-mac    — build macOS in Docker
#   make docker-mac-arm — build macOS ARM64 in Docker
#   make clean         — remove build artifacts
#   make typecheck     — run TypeScript type check
#   make test          — run all tests
#   make test-e2e      — run E2E tests (Playwright)
#   make help          — show this help
#
# Tauri (separate build target, does NOT break Electron):
#   make tauri-install — install Tauri CLI
#   make tauri-dev     — run Tauri dev mode (Rust + Vite HMR)
#   make tauri-build   — build production Tauri installer (current OS)
#   make tauri-check   — cargo check (type-check Rust backend)
#   make tauri-clean   — remove src-tauri/target/
#
# Tauri — platform-specific builds (mirror Electron's package-* targets):
#   make package-mac-tauri        — universal macOS (Intel + Apple Silicon)
#   make package-mac-tauri-arm   — macOS ARM only (Apple Silicon)
#   make package-mac-tauri-x64   — macOS Intel only (x64)
#   make package-linux-tauri     — Linux (AppImage + deb)
#   make package-windows-tauri   — Windows (MSI + NSIS exe)
#   make package-tauri-all       — alias for 'make tauri-build' (current OS)
#   make tauri-release-check     — list all Tauri build artifacts
#
# Tauri — Rust targets management (for cross-compilation):
#   make tauri-list-targets          — show installed Rust targets
#   make tauri-add-target-mac-arm    — add aarch64-apple-darwin
#   make tauri-add-target-mac-x64    — add x86_64-apple-darwin
#   make tauri-add-target-mac-universal — add both macOS targets
#   make tauri-add-target-linux      — add x86_64-unknown-linux-gnu
#   make tauri-add-target-windows    — add x86_64-pc-windows-msvc
#
# =============================================================================

# Project paths
PROJECT_DIR  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
APP_NAME     := PrismGit
APP_NAME_LC  := prismgit
APP_VERSION  := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

# Detect platform
UNAME_S := $(shell uname -s 2>/dev/null || echo "")
UNAME_M := $(shell uname -m 2>/dev/null || echo "")
IS_MAC   := $(filter Darwin,$(UNAME_S))
IS_LINUX := $(filter Linux,$(UNAME_S))
IS_WIN   := $(filter MINGW% MSYS% CYGWIN%,$(UNAME_S))

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
COLOR_RED    := \033[31m

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Help
# =============================================================================

.PHONY: help
help: ## Show this help message
        @echo ""
        @echo "$(COLOR_BOLD)PrismGit v$(APP_VERSION) — Makefile$(COLOR_RESET)"
        @echo ""
        @echo "$(COLOR_CYAN)Quick start:$(COLOR_RESET)"
        @echo "  make install         # first-time: install npm deps"
        @echo "  make dev             # Electron dev mode + Vite HMR"
        @echo "  make tauri-dev       # Tauri dev mode (requires Rust)"
        @echo "  make package         # build + package for current OS"
        @echo "  make help            # this message"
        @echo ""
        @echo "$(COLOR_CYAN)Environment:$(COLOR_RESET)"
        @echo "  make doctor          # check Node / Rust / Docker + disk usage"
        @echo "  make install-full    # install deps + check Rust + Docker"
        @echo "  make upgrade         # check for outdated npm deps"
        @echo ""
        @echo "$(COLOR_CYAN)All targets:$(COLOR_RESET)"
        @grep -E '^[a-zA-Z_-]+:.*## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  $(COLOR_GREEN)%-26s$(COLOR_RESET) %s\n", $$1, $$2}' | sort
        @echo ""
        @echo "$(COLOR_CYAN)Common workflows:$(COLOR_RESET)"
        @echo "  make pre-commit      # format + typecheck + unit tests (before commit)"
        @echo "  make pre-push        # pre-commit + integration tests (before push)"
        @echo "  make audit           # security + WCAG + i18n + bundle audits"
        @echo "  make release-prep    # full CI pipeline + build + version bump"
        @echo "  make docker-all      # cross-platform build (Linux/Win/Mac)"
        @echo ""
        @echo "$(COLOR_CYAN)Platform:$(COLOR_RESET) $(UNAME_S) $(UNAME_M)"
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
        @ls -lh release/*.* 2>/dev/null || true

.PHONY: package-linux
package-linux: build ## Package for Linux (AppImage, deb, rpm)
        @echo "$(COLOR_YELLOW)→ Packaging for Linux...$(COLOR_RESET)"
        $(NPM) run package:linux
        @echo "$(COLOR_GREEN)✓ Linux package complete$(COLOR_RESET)"
        @ls -lh release/*.* 2>/dev/null || true

.PHONY: package-win
package-win: build ## Package for Windows (NSIS)
        @echo "$(COLOR_YELLOW)→ Packaging for Windows...$(COLOR_RESET)"
        $(NPM) run package:win
        @echo "$(COLOR_GREEN)✓ Windows package complete$(COLOR_RESET)"
        @ls -lh release/*.* 2>/dev/null || true

.PHONY: package-mac
package-mac: build ## Package for macOS (dmg, universal x64+arm64)
        @echo "$(COLOR_YELLOW)→ Packaging for macOS (universal)...$(COLOR_RESET)"
        $(NPM) run package:mac
        @echo "$(COLOR_GREEN)✓ macOS package complete$(COLOR_RESET)"
        @ls -lh release/*.* 2>/dev/null || true

.PHONY: package-mac-arm
package-mac-arm: build ## Package for macOS ARM (Apple Silicon only)
        @echo "$(COLOR_YELLOW)→ Packaging for macOS ARM64 (Apple Silicon)...$(COLOR_RESET)"
        $(NPM) run package:mac-arm
        @echo "$(COLOR_GREEN)✓ macOS ARM package complete$(COLOR_RESET)"
        @ls -lh release/*.* 2>/dev/null || true

.PHONY: package-mac-x64
package-mac-x64: build ## Package for macOS Intel (x64 only)
        @echo "$(COLOR_YELLOW)→ Packaging for macOS x64 (Intel)...$(COLOR_RESET)"
        $(NPM) run package:mac-x64
        @echo "$(COLOR_GREEN)✓ macOS x64 package complete$(COLOR_RESET)"
        @ls -lh release/*.* 2>/dev/null || true

# =============================================================================
# Docker Builds (all platforms)
# =============================================================================

.PHONY: docker-build
docker-build: ## Build Docker image for Linux (default)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Linux Docker image...$(COLOR_RESET)"
        $(DOCKER) build -t $(APP_NAME_LC):linux -f Dockerfile.linux .

.PHONY: docker-build-win
docker-build-win: ## Build Docker image for Windows (with Wine)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Windows Docker image...$(COLOR_RESET)"
        $(DOCKER) build -t $(APP_NAME_LC):win -f Dockerfile.win .

.PHONY: docker-build-mac
docker-build-mac: ## Build Docker image for macOS
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS Docker image...$(COLOR_RESET)"
        $(DOCKER) build -t $(APP_NAME_LC):mac -f Dockerfile.mac --build-arg ARCH=x64 .

.PHONY: docker-build-mac-arm64
docker-build-mac-arm64: ## Build Docker image for macOS ARM64
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building macOS ARM64 Docker image...$(COLOR_RESET)"
        $(DOCKER) build -t $(APP_NAME_LC):mac-arm64 -f Dockerfile.mac --build-arg ARCH=arm64 .

.PHONY: docker-all
docker-all: docker-linux docker-win docker-mac docker-mac-arm64 ## Build all platforms via Docker
        @echo "$(COLOR_GREEN)✓ All Docker builds complete$(COLOR_RESET)"

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

.PHONY: test-e2e
test-e2e: ## Run E2E tests (Playwright, requires built app)
        @echo "$(COLOR_YELLOW)→ Running E2E tests...$(COLOR_RESET)"
        $(NPM) run test:e2e
        @echo "$(COLOR_GREEN)✓ E2E tests complete$(COLOR_RESET)"

.PHONY: test-e2e-headed
test-e2e-headed: ## Run E2E tests in headed mode (Linux: uses xvfb)
        @echo "$(COLOR_YELLOW)→ Running E2E tests (headed)...$(COLOR_RESET)"
        $(NPM) run test:e2e:headed
        @echo "$(COLOR_GREEN)✓ E2E tests complete$(COLOR_RESET)"

.PHONY: test-verify
test-verify: ## Full verification pipeline (typecheck + test + build + e2e)
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)→ Full verification pipeline...$(COLOR_RESET)"
        $(NPX) tsc --noEmit
        $(NPX) vitest run
        $(NPM) run build
        $(NPM) run test:e2e
        @echo "$(COLOR_GREEN)✓ Full verification passed$(COLOR_RESET)"

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
        -$(DOCKER) rmi $(APP_NAME_LC):linux $(APP_NAME_LC):win $(APP_NAME_LC):mac $(APP_NAME_LC):mac-arm64 2>/dev/null || true
        @echo "$(COLOR_GREEN)✓ All clean$(COLOR_RESET)"

.PHONY: clean-docker
clean-docker: ## Remove Docker images and build cache
        -$(DOCKER) rmi $(APP_NAME_LC):linux $(APP_NAME_LC):win $(APP_NAME_LC):mac $(APP_NAME_LC):mac-arm64 2>/dev/null || true
        -$(DOCKER) builder prune -f 2>/dev/null || true

.PHONY: clean-test
clean-test: ## Remove test artifacts and coverage
        rm -rf coverage test-results .nyc_output
        @echo "$(COLOR_GREEN)✓ Test artifacts cleaned$(COLOR_RESET)"

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
BUMP_VERSION ?= patch
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

.PHONY: i18n-check
i18n-check: ## Check i18n translation completeness
        @echo "$(COLOR_YELLOW)→ Checking i18n translations...$(COLOR_RESET)"
        @for lang in en ru zh de; do \
                count=$$(grep -c "':" src/i18n/locales/$$lang.ts 2>/dev/null || echo 0); \
                echo "  $$lang: $$count keys"; \
        done
        @echo "$(COLOR_GREEN)✓ i18n check complete$(COLOR_RESET)"

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
# Phony declarations
# =============================================================================

.PHONY: all
all: typecheck build ## Type-check then build

.PHONY: ci
ci: install-ci check test build ## CI pipeline: install + check + test + build
        @echo "$(COLOR_GREEN)✓ CI complete$(COLOR_RESET)"

# =============================================================================
# Tauri — separate build target (does NOT break Electron build)
# =============================================================================
# Run `make tauri-dev` to start the Tauri dev mode (Rust backend + Vite
# frontend with HMR). Run `make tauri-build` to produce a production
# installer for the current OS (~5-8 MB vs Electron's ~80-120 MB).
#
# Tauri requires:
#   - Rust toolchain (curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh)
#   - System dependencies:
#       Linux:  sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
#       macOS:  xcode command line tools (xcode-select --install)
#       Windows: Microsoft Visual C++ Build Tools + WebView2 runtime
#
# The first `make tauri-build` will compile all Rust dependencies —
# expect 5-10 minutes for the initial build. Subsequent builds are
# incremental and take seconds.

.PHONY: tauri-install
tauri-install: ## Install Tauri CLI globally
        @echo "$(COLOR_YELLOW)→ Installing Tauri CLI...$(COLOR_RESET)"
        @npm install -D @tauri-apps/cli@^2.0.0
        @echo "$(COLOR_GREEN)✓ Tauri CLI installed$(COLOR_RESET)"

.PHONY: tauri-dev
tauri-dev: ## Run Tauri in dev mode (Rust backend + Vite HMR frontend)
        @echo "$(COLOR_YELLOW)→ Starting Tauri dev mode...$(COLOR_RESET)"
        @echo "  Tauri will start the Vite dev server automatically (per tauri.conf.json beforeDevCommand)."
        @echo "  Frontend: http://localhost:5173"
        @npx tauri dev

.PHONY: tauri-build
tauri-build: ## Build production Tauri installer for current OS
        @echo "$(COLOR_YELLOW)→ Building Tauri production package...$(COLOR_RESET)"
        @npm run build
        @npx tauri build
        @echo "$(COLOR_GREEN)✓ Tauri installer ready in src-tauri/target/release/bundle/$(COLOR_RESET)"

.PHONY: tauri-clean
tauri-clean: ## Remove Tauri build artifacts (target/ directory)
        @echo "$(COLOR_YELLOW)→ Cleaning Tauri build artifacts...$(COLOR_RESET)"
        @rm -rf src-tauri/target
        @echo "$(COLOR_GREEN)✓ Tauri clean done$(COLOR_RESET)"

.PHONY: tauri-check
tauri-check: ## Type-check the Rust backend (cargo check)
        @echo "$(COLOR_YELLOW)→ Checking Rust backend...$(COLOR_RESET)"
        @cd src-tauri && cargo check
        @echo "$(COLOR_GREEN)✓ Rust check OK$(COLOR_RESET)"

# =============================================================================
# Tauri — platform-specific build targets (mirror the Electron ones)
# =============================================================================
# Each target produces a native installer for the named platform in
# src-tauri/target/<rust-target>/release/bundle/<format>/.
#
# Tauri cross-compilation caveats:
#   - macOS universal binary requires both `aarch64-apple-darwin` and
#     `x86_64-apple-darwin` Rust targets installed (`rustup target add ...`).
#   - Building for Windows from non-Windows requires `cargo-xwin` or a
#     Windows VM. Tauri does NOT support Wine-based cross-builds.
#   - Building for Linux from macOS/Windows requires Docker with the
#     `tauri-apps/tauri` image, OR `cargo-zigbuild` + `zig` as a linker.
#
# Run `make tauri-list-targets` to see all installed Rust targets.

.PHONY: tauri-list-targets
tauri-list-targets: ## List installed Rust targets (for cross-compilation)
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)Installed Rust targets:$(COLOR_RESET)"
        @rustup target list --installed 2>/dev/null || echo "  rustup not found"
        @echo ""
        @echo "Available targets (install with 'rustup target add <name>'):"
        @echo "  aarch64-apple-darwin     macOS Apple Silicon (M1/M2/M3)"
        @echo "  x86_64-apple-darwin      macOS Intel"
        @echo "  x86_64-unknown-linux-gnu Linux x64"
        @echo "  x86_64-pc-windows-msvc   Windows x64 (MSVC)"

.PHONY: tauri-add-target-mac-arm
tauri-add-target-mac-arm: ## Add Rust target for macOS ARM (Apple Silicon)
        @rustup target add aarch64-apple-darwin

.PHONY: tauri-add-target-mac-x64
tauri-add-target-mac-x64: ## Add Rust target for macOS Intel (x64)
        @rustup target add x86_64-apple-darwin

.PHONY: tauri-add-target-mac-universal
tauri-add-target-mac-universal: tauri-add-target-mac-arm tauri-add-target-mac-x64 ## Add both macOS targets (for universal binary)

.PHONY: tauri-add-target-linux
tauri-add-target-linux: ## Add Rust target for Linux x64
        @rustup target add x86_64-unknown-linux-gnu

.PHONY: tauri-add-target-windows
tauri-add-target-windows: ## Add Rust target for Windows x64 (MSVC)
        @rustup target add x86_64-pc-windows-msvc

.PHONY: package-mac-tauri
package-mac-tauri: ## Build Tauri for macOS (universal: Intel + Apple Silicon)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri macOS (universal binary)...$(COLOR_RESET)"
        @echo "  Make sure both targets are installed: rustup target add aarch64-apple-darwin x86_64-apple-darwin"
        @npm run build
        @npx tauri build --target universal-apple-darwin
        @echo "$(COLOR_GREEN)✓ macOS Tauri build complete$(COLOR_RESET)"
        @find src-tauri/target/universal-apple-darwin/release/bundle -type f \( -name "*.dmg" -o -name "*.app" \) -exec ls -lh {} \; 2>/dev/null

.PHONY: package-mac-tauri-arm
package-mac-tauri-arm: ## Build Tauri for macOS ARM (Apple Silicon only)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri macOS ARM64 (Apple Silicon)...$(COLOR_RESET)"
        @npm run build
        @npx tauri build --target aarch64-apple-darwin
        @echo "$(COLOR_GREEN)✓ macOS ARM Tauri build complete$(COLOR_RESET)"
        @find src-tauri/target/aarch64-apple-darwin/release/bundle -type f \( -name "*.dmg" -o -name "*.app" \) -exec ls -lh {} \; 2>/dev/null

.PHONY: package-mac-tauri-x64
package-mac-tauri-x64: ## Build Tauri for macOS Intel (x64 only)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri macOS x64 (Intel)...$(COLOR_RESET)"
        @npm run build
        @npx tauri build --target x86_64-apple-darwin
        @echo "$(COLOR_GREEN)✓ macOS x64 Tauri build complete$(COLOR_RESET)"
        @find src-tauri/target/x86_64-apple-darwin/release/bundle -type f \( -name "*.dmg" -o -name "*.app" \) -exec ls -lh {} \; 2>/dev/null

.PHONY: package-linux-tauri
package-linux-tauri: ## Build Tauri for Linux (AppImage + deb)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri Linux (AppImage + deb)...$(COLOR_RESET)"
        @npm run build
        @npx tauri build
        @echo "$(COLOR_GREEN)✓ Linux Tauri build complete$(COLOR_RESET)"
        @find src-tauri/target/release/bundle -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" \) -exec ls -lh {} \; 2>/dev/null

.PHONY: package-windows-tauri
package-windows-tauri: ## Build Tauri for Windows (MSI + NSIS exe)
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri Windows (MSI + NSIS)...$(COLOR_RESET)"
        @npm run build
        @npx tauri build
        @echo "$(COLOR_GREEN)✓ Windows Tauri build complete$(COLOR_RESET)"
        @find src-tauri/target/release/bundle -type f \( -name "*.msi" -o -name "*.exe" -o -name "*.nsis" \) -exec ls -lh {} \; 2>/dev/null

.PHONY: package-tauri-all
package-tauri-all: ## Build Tauri for current OS (one-shot, like 'make tauri-build')
        @echo "$(COLOR_BOLD)$(COLOR_BLUE)→ Building Tauri for current OS...$(COLOR_RESET)"
        @$(MAKE) tauri-build

.PHONY: tauri-release-check
tauri-release-check: ## List all Tauri build artifacts in src-tauri/target/
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)Tauri release artifacts:$(COLOR_RESET)"
        @find src-tauri/target -type f \( -name "*.dmg" -o -name "*.app" -o -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.msi" -o -name "*.exe" -o -name "*.nsis" \) -exec ls -lh {} \; 2>/dev/null || echo "  No artifacts found. Run 'make package-mac-tauri' first."

# =============================================================================
# Environment diagnostics & one-time setup
# =============================================================================

.PHONY: doctor
doctor: ## Check dev environment (Node, Rust, system deps)
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)PrismGit environment diagnostics:$(COLOR_RESET)"
        @echo ""
        @echo "$(COLOR_BOLD)Runtime:$(COLOR_RESET)"
        @echo "  Node.js:   $$(node --version 2>/dev/null || echo '$(COLOR_RED)missing$(COLOR_RESET)')"
        @echo "  npm:       $$(npm --version 2>/dev/null || echo '$(COLOR_RED)missing$(COLOR_RESET)')"
        @echo "  Rust:     $$(rustc --version 2>/dev/null || echo '$(COLOR_YELLOW)not installed (only needed for Tauri)$(COLOR_RESET)')"
        @echo "  Cargo:    $$(cargo --version 2>/dev/null || echo '$(COLOR_YELLOW)not installed (only needed for Tauri)$(COLOR_RESET)')"
        @echo "  Docker:   $$(docker --version 2>/dev/null || echo '$(COLOR_YELLOW)not installed (only needed for cross-platform builds)$(COLOR_RESET)')"
        @echo ""
        @echo "$(COLOR_BOLD)Project:$(COLOR_RESET)"
        @echo "  Version:  v$(APP_VERSION)"
        @echo "  Platform: $(UNAME_S) $(UNAME_M)"
        @echo "  Path:     $(PROJECT_DIR)"
        @echo ""
        @echo "$(COLOR_BOLD)Git status:$(COLOR_RESET)"
        @cd $(PROJECT_DIR) && git status --short 2>/dev/null | head -10 || echo "  (not a git repo)"
        @echo ""
        @echo "$(COLOR_BOLD)Disk usage:$(COLOR_RESET)"
        @du -sh node_modules dist dist-electron src-tauri/target release coverage 2>/dev/null | awk '{printf "  %-30s %s\n", $$2, $$1}' || true
        @echo ""
        @echo "$(COLOR_GREEN)✓ Diagnostics complete$(COLOR_RESET)"

.PHONY: install-full
install-full: install ## Install npm deps + check Rust + check system deps
        @echo ""
        @echo "$(COLOR_YELLOW)→ Checking optional Rust toolchain for Tauri...$(COLOR_RESET)"
        @which rustc > /dev/null 2>&1 && echo "  $(COLOR_GREEN)✓ Rust installed$(COLOR_RESET)" || ( \
          echo "  $(COLOR_YELLOW)Rust not installed. To enable Tauri build:$(COLOR_RESET)"; \
          echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; \
          echo "  then run: make tauri-install" )
        @echo ""
        @echo "$(COLOR_YELLOW)→ Checking Docker for cross-platform builds...$(COLOR_RESET)"
        @which docker > /dev/null 2>&1 && echo "  $(COLOR_GREEN)✓ Docker installed$(COLOR_RESET)" || \
          echo "  $(COLOR_YELLOW)Docker not installed (only needed for make docker-all)$(COLOR_RESET)"
        @echo ""
        @echo "$(COLOR_GREEN)✓ Full install complete$(COLOR_RESET)"
        @echo "  Next: make dev       (Electron dev mode)"
        @echo "  Next: make tauri-dev (Tauri dev mode, requires Rust)"

# =============================================================================
# Quick checks & pre-commit hooks
# =============================================================================

.PHONY: quick-check
quick-check: ## Fast pre-commit check (typecheck + unit tests only)
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)→ Quick check (typecheck + unit tests)...$(COLOR_RESET)"
        @$(NPX) tsc --noEmit
        @$(NPX) vitest run tests/unit
        @echo "$(COLOR_GREEN)✓ Quick check passed$(COLOR_RESET)"

.PHONY: pre-commit
pre-commit: format quick-check ## Full pre-commit: format + typecheck + unit tests
        @echo "$(COLOR_GREEN)✓ Pre-commit checks passed — safe to commit$(COLOR_RESET)"

.PHONY: pre-push
pre-push: pre-commit test-integration ## Pre-push: pre-commit + integration tests
        @echo "$(COLOR_GREEN)✓ Pre-push checks passed — safe to push$(COLOR_RESET)"

# =============================================================================
# Audits (security + accessibility + bundle size)
# =============================================================================

.PHONY: audit
audit: ## Run all audits (security + accessibility + bundle size)
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)→ Running full audit suite...$(COLOR_RESET)"
        @echo ""
        @echo "$(COLOR_BOLD)1. npm security audit:$(COLOR_RESET)"
        @$(NPM) audit --audit-level=moderate || true
        @echo ""
        @echo "$(COLOR_BOLD)2. WCAG color-contrast audit (15 themes):$(COLOR_RESET)"
        @node scripts/audit-contrast.mjs
        @echo ""
        @echo "$(COLOR_BOLD)3. i18n parity audit (en/ru/zh/de):$(COLOR_RESET)"
        @$(NPX) vitest run tests/unit/i18nParity.test.ts
        @echo ""
        @echo "$(COLOR_BOLD)4. Bundle size report:$(COLOR_RESET)"
        @if [ -d dist ]; then \
          du -sh dist dist-electron 2>/dev/null; \
          echo "  Renderer chunks:"; \
          ls -lh dist/assets/*.js 2>/dev/null | awk '{printf "    %s\n", $$0}'; \
        else \
          echo "  $(COLOR_YELLOW)No build found. Run 'make build' first.$(COLOR_RESET)"; \
        fi
        @echo ""
        @echo "$(COLOR_GREEN)✓ Full audit complete$(COLOR_RESET)"

.PHONY: audit-fix
audit-fix: ## Auto-fix npm security vulnerabilities
        @echo "$(COLOR_YELLOW)→ Running npm audit fix...$(COLOR_RESET)"
        @$(NPM) audit fix
        @echo "$(COLOR_GREEN)✓ Audit fix complete — review changes in package-lock.json$(COLOR_RESET)"

# =============================================================================
# Dependency upgrade
# =============================================================================

.PHONY: upgrade
upgrade: ## Check for outdated dependencies
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)→ Checking for outdated dependencies...$(COLOR_RESET)"
        @$(NPX) npm-check-updates -u 2>/dev/null || \
          $(NPM) outdated || echo "  Run 'npm install' after reviewing the list above."
        @echo ""
        @echo "$(COLOR_YELLOW)Run 'npm install' to apply updates, then 'make quick-check'.$(COLOR_RESET)"

.PHONY: upgrade-tauri-cli
upgrade-tauri-cli: ## Upgrade Tauri CLI to latest
        @echo "$(COLOR_YELLOW)→ Upgrading @tauri-apps/cli...$(COLOR_RESET)"
        @$(NPM) install -D @tauri-apps/cli@latest
        @echo "$(COLOR_GREEN)✓ Tauri CLI updated$(COLOR_RESET)"

# =============================================================================
# Release preparation
# =============================================================================

.PHONY: release-prep
release-prep: ## Prepare a release: bump version, run full CI pipeline, build all artifacts
        @echo "$(COLOR_BOLD)$(COLOR_CYAN)→ Release preparation...$(COLOR_RESET)"
        @echo "  Current version: $(APP_VERSION)"
        @echo "  Next version:    $$(node -p "require('./package.json').version")"
        @echo ""
        @$(MAKE) pre-push
        @$(MAKE) build
        @echo ""
        @echo "$(COLOR_GREEN)✓ Release prepared — commit and tag:$(COLOR_RESET)"
        @echo "  git add -A && git commit -m 'release: v$(APP_VERSION)'"
        @echo "  git tag v$(APP_VERSION)"
        @echo "  git push origin v$(APP_VERSION)"

# =============================================================================
# Cache management
# =============================================================================

.PHONY: clean-cache
clean-cache: ## Clear Vite / Vitest / TS caches
        @echo "$(COLOR_YELLOW)→ Clearing caches...$(COLOR_RESET)"
        @rm -rf .vite .vitest node_modules/.vite node_modules/.cache tsconfig.tsbuildinfo
        @echo "$(COLOR_GREEN)✓ Caches cleared$(COLOR_RESET)"

.PHONY: clean-all-including-tauri
clean-all-including-tauri: clean clean-cache ## Deep clean: build artifacts + caches + Tauri target
        @echo "$(COLOR_YELLOW)→ Cleaning Tauri target...$(COLOR_RESET)"
        @rm -rf src-tauri/target src-tauri/gen
        @echo "$(COLOR_GREEN)✓ Deep clean complete$(COLOR_RESET)"

# =============================================================================
# Browser / dev tooling install
# =============================================================================

.PHONY: e2e-install
e2e-install: ## Install Playwright browsers (one-time)
        @echo "$(COLOR_YELLOW)→ Installing Playwright browsers...$(COLOR_RESET)"
        @$(NPX) playwright install --with-deps
        @echo "$(COLOR_GREEN)✓ Playwright browsers installed$(COLOR_RESET)"

# =============================================================================
# Convenience aliases
# =============================================================================

.PHONY: r
r: dev ## Alias for 'make dev'

.PHONY: b
b: build ## Alias for 'make build'

.PHONY: t
t: test ## Alias for 'make test'

.PHONY: tc
tc: typecheck ## Alias for 'make typecheck'
