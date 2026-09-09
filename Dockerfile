# =============================================================================
# SmartGit Electron — Multi-platform Docker Build
# =============================================================================
# Builds installers for Linux, Windows, and macOS in a single container.
# Linux: native build
# Windows: cross-compiled using Wine
# macOS: builds .zip and .dmg (dmg requires macos runner for full functionality,
#         but electron-builder can produce unsigned builds on Linux)
# =============================================================================

# Build stage
FROM docker.io/library/node:20-bookworm-slim AS builder

# Install build dependencies including Wine for Windows cross-compilation
RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    # Native build tools
    python3 \
    make \
    g++ \
    pkg-config \
    git \
    ca-certificates \
    # Electron native dependencies
    libsecret-1-dev \
    libgtk-3-dev \
    libnotify-dev \
    libnss3-dev \
    libxss1 \
    libxtst-dev \
    xauth \
    xvfb \
    libgbm-dev \
    libasound2-dev \
    libdbus-1-dev \
    libxkbcommon-dev \
    libwayland-dev \
    # Image tools for icons
    icnsutils \
    imagemagick \
    graphicsmagick \
    # Wine for Windows cross-compile (i386 + amd64)
    wine64 \
    wine32 \
    wine \
    winetricks \
    # For macOS icon generation
    zlib1g \
    # Helper tools
    curl \
    unzip \
    rsync \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Initialize Wine prefix (avoids first-run prompts during build)
ENV WINEPREFIX=/tmp/wine
ENV WINEDEBUG=-all
RUN mkdir -p $WINEPREFIX && wineboot --init 2>/dev/null || true
RUN wineserver --wait 2>/dev/null || true

# Set up working directory
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Build the renderer and main process
RUN npm run build

# Default output directory
ENV OUTPUT_DIR=/app/release
RUN mkdir -p $OUTPUT_DIR

# =============================================================================
# Build targets — invoked via build args
# =============================================================================
# Usage:
#   docker build -t smartgit-electron:linux  --build-arg TARGET=linux  .
#   docker build -t smartgit-electron:win   --build-arg TARGET=win   .
#   docker build -t smartgit-electron:mac   --build-arg TARGET=mac   .
#   docker build -t smartgit-electron:all   --build-arg TARGET=all   .
# =============================================================================

ARG TARGET=linux
ARG ARCH=x64

# Build for the requested target
RUN if [ "$TARGET" = "all" ]; then \
      echo "Building all targets: linux, win, mac" && \
      npx electron-builder --linux --win --mac; \
    elif [ "$TARGET" = "linux" ]; then \
      echo "Building Linux ($ARCH)" && \
      npx electron-builder --linux --${ARCH}; \
    elif [ "$TARGET" = "win" ]; then \
      echo "Building Windows ($ARCH) using Wine" && \
      npx electron-builder --win --${ARCH}; \
    elif [ "$TARGET" = "mac" ]; then \
      echo "Building macOS ($ARCH)" && \
      npx electron-builder --mac --${ARCH}; \
    else \
      echo "Unknown target: $TARGET" && exit 1; \
    fi

# =============================================================================
# Runtime stage — minimal image with built artifacts
# =============================================================================
FROM docker.io/library/debian:bookworm-slim AS runtime

# Copy release artifacts from builder
COPY --from=builder /app/release /release

# Add a simple entrypoint script that lists artifacts
RUN echo '#!/bin/sh\nls -lh /release/' > /usr/local/bin/list-artifacts \
  && chmod +x /usr/local/bin/list-artifacts

# Default: print artifacts
CMD ["list-artifacts"]
