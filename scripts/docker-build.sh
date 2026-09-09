#!/usr/bin/env bash
# =============================================================================
# SmartGit Electron — Multi-platform Docker Build Script
# =============================================================================
# Usage:
#   ./docker-build.sh              # build all platforms
#   ./docker-build.sh linux        # build Linux only
#   ./docker-build.sh win          # build Windows only
#   ./docker-build.sh mac          # build macOS (x64) only
#   ./docker-build.sh mac-arm64    # build macOS (arm64) only
#   ./docker-build.sh all          # build all platforms
# =============================================================================

set -e

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR]${NC} $*" >&2; }

# Check Docker
if ! command -v docker &> /dev/null; then
    err "Docker is not installed or not in PATH"
    exit 1
fi

if ! docker info &> /dev/null; then
    err "Docker daemon is not running"
    exit 1
fi

# Default target
TARGET="${1:-all}"

# Clean previous release directory
clean_release() {
    local platform="$1"
    if [ -d "release/$platform" ]; then
        log "Cleaning release/$platform..."
        rm -rf "release/$platform"
    fi
    mkdir -p "release/$platform"
}

# Build for a single platform
build_platform() {
    local platform="$1"
    local arch="${2:-x64}"
    local service_name="build-${platform}"
    if [ "$arch" != "x64" ] && [ "$platform" = "mac" ]; then
        service_name="build-mac-arm64"
    fi

    log "Building ${platform} (${arch})..."
    clean_release "${platform}-${arch}"

    if ! docker compose run --rm "$service_name"; then
        err "Build failed for ${platform} (${arch})"
        return 1
    fi

    ok "Build succeeded for ${platform} (${arch})"
    ls -lh "release/${platform}-${arch}/" 2>/dev/null || true
}

# Build all platforms
build_all() {
    log "Building ALL platforms (linux, win, mac x64, mac arm64)..."
    local failed=()

    build_platform linux x64 || failed+=("linux")
    build_platform win x64 || failed+=("win")
    build_platform mac x64 || failed+=("mac-x64")
    build_platform mac arm64 || failed+=("mac-arm64")

    echo ""
    log "================================================"
    if [ ${#failed[@]} -eq 0 ]; then
        ok "All platforms built successfully!"
    else
        err "Failed platforms: ${failed[*]}"
    fi
    log "================================================"
    echo ""
    log "Artifacts in ./release/:"
    find release -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.zip" \) -exec ls -lh {} \;
}

# Main
case "$TARGET" in
    all)
        build_all
        ;;
    linux)
        build_platform linux x64
        ;;
    win|windows)
        build_platform win x64
        ;;
    mac|macos)
        build_platform mac x64
        ;;
    mac-arm64|macos-arm64)
        build_platform mac arm64
        ;;
    *)
        err "Unknown target: $TARGET"
        echo "Usage: $0 [all|linux|win|mac|mac-arm64]"
        exit 1
        ;;
esac
