#!/usr/bin/env bash
# =============================================================================
# PrismGit — Multi-platform Docker Build Script
# =============================================================================
# Usage:
#   ./scripts/docker-build.sh              # build all platforms
#   ./scripts/docker-build.sh linux        # build Linux only
#   ./scripts/docker-build.sh win          # build Windows only
#   ./scripts/docker-build.sh mac          # build macOS (x64) only
#   ./scripts/docker-build.sh mac-arm64    # build macOS (arm64) only
#   ./scripts/docker-build.sh all          # build all platforms
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

# Build for Linux
build_linux() {
    log "Building Linux (x64)..."
    clean_release "linux"

    if ! docker compose run --rm build-linux; then
        err "Build failed for Linux"
        return 1
    fi

    ok "Build succeeded for Linux"
    ls -lh release/linux/ 2>/dev/null || true
    # Copy artifacts from container if volume mount didn't work
    if [ -z "$(ls -A release/linux 2>/dev/null)" ]; then
        warn "Volume mount may have failed, copying artifacts from image..."
        docker create --name smartgit-tmp-linux smartgit-electron:linux 2>/dev/null || true
        docker cp smartgit-tmp-linux:/release/. release/linux/ 2>/dev/null || true
        docker rm smartgit-tmp-linux 2>/dev/null || true
    fi
}

# Build for Windows
build_win() {
    log "Building Windows (x64) via Wine..."
    clean_release "win"

    if ! docker compose run --rm build-win; then
        err "Build failed for Windows"
        return 1
    fi

    ok "Build succeeded for Windows"
    ls -lh release/win/ 2>/dev/null || true
    if [ -z "$(ls -A release/win 2>/dev/null)" ]; then
        warn "Volume mount may have failed, copying artifacts from image..."
        docker create --name smartgit-tmp-win smartgit-electron:win 2>/dev/null || true
        docker cp smartgit-tmp-win:/release/. release/win/ 2>/dev/null || true
        docker rm smartgit-tmp-win 2>/dev/null || true
    fi
}

# Build for macOS (Intel)
build_mac() {
    log "Building macOS (x64)..."
    clean_release "mac"

    if ! docker compose run --rm build-mac; then
        err "Build failed for macOS x64"
        return 1
    fi

    ok "Build succeeded for macOS x64"
    ls -lh release/mac/ 2>/dev/null || true
    if [ -z "$(ls -A release/mac 2>/dev/null)" ]; then
        warn "Volume mount may have failed, copying artifacts from image..."
        docker create --name smartgit-tmp-mac smartgit-electron:mac 2>/dev/null || true
        docker cp smartgit-tmp-mac:/release/. release/mac/ 2>/dev/null || true
        docker rm smartgit-tmp-mac 2>/dev/null || true
    fi
}

# Build for macOS (Apple Silicon)
build_mac_arm64() {
    log "Building macOS (arm64)..."
    clean_release "mac-arm64"

    if ! docker compose run --rm build-mac-arm64; then
        err "Build failed for macOS arm64"
        return 1
    fi

    ok "Build succeeded for macOS arm64"
    ls -lh release/mac-arm64/ 2>/dev/null || true
    if [ -z "$(ls -A release/mac-arm64 2>/dev/null)" ]; then
        warn "Volume mount may have failed, copying artifacts from image..."
        docker create --name smartgit-tmp-mac-arm64 smartgit-electron:mac-arm64 2>/dev/null || true
        docker cp smartgit-tmp-mac-arm64:/release/. release/mac-arm64/ 2>/dev/null || true
        docker rm smartgit-tmp-mac-arm64 2>/dev/null || true
    fi
}

# Build all platforms
build_all() {
    log "Building ALL platforms (linux, win, mac x64, mac arm64)..."
    local failed=()

    build_linux || failed+=("linux")
    build_win || failed+=("win")
    build_mac || failed+=("mac-x64")
    build_mac_arm64 || failed+=("mac-arm64")

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
    find release -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.zip" \) -exec ls -lh {} \; 2>/dev/null || echo "  No artifacts found"
}

# Alternative: build directly with docker build (no compose)
build_direct() {
    local platform="$1"
    local arch="$2"
    local dockerfile="Dockerfile.${platform}"
    local image_name="smartgit-electron:${platform}"
    local out_dir="release/${platform}"

    if [ "$arch" = "arm64" ] && [ "$platform" = "mac" ]; then
        image_name="smartgit-electron:mac-arm64"
        out_dir="release/mac-arm64"
    fi

    log "Building ${platform} (${arch}) directly..."
    clean_release "$(basename $out_dir)"

    if [ "$arch" = "arm64" ]; then
        docker build -t "$image_name" --build-arg ARCH=arm64 -f "$dockerfile" .
    else
        docker build -t "$image_name" -f "$dockerfile" .
    fi

    if [ $? -ne 0 ]; then
        err "Build failed for ${platform}"
        return 1
    fi

    # Copy artifacts from image
    log "Copying artifacts from image..."
    docker create --name "smartgit-tmp-${platform}" "$image_name" 2>/dev/null || true
    docker cp "smartgit-tmp-${platform}":/release/. "$out_dir/" 2>/dev/null || true
    docker rm "smartgit-tmp-${platform}" 2>/dev/null || true

    ok "Build succeeded for ${platform}"
    ls -lh "$out_dir/" 2>/dev/null || true
}

# Main
case "$TARGET" in
    all)
        build_all
        ;;
    linux)
        build_linux
        ;;
    win|windows)
        build_win
        ;;
    mac|macos)
        build_mac
        ;;
    mac-arm64|macos-arm64)
        build_mac_arm64
        ;;
    direct-linux)
        build_direct linux x64
        ;;
    direct-win)
        build_direct win x64
        ;;
    direct-mac)
        build_direct mac x64
        ;;
    direct-mac-arm64)
        build_direct mac arm64
        ;;
    *)
        err "Unknown target: $TARGET"
        echo ""
        echo "Usage: $0 [all|linux|win|mac|mac-arm64]"
        echo ""
        echo "Alternative (direct docker build, no compose):"
        echo "  $0 direct-linux"
        echo "  $0 direct-win"
        echo "  $0 direct-mac"
        echo "  $0 direct-mac-arm64"
        exit 1
        ;;
esac
