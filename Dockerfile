# Stage 1: Build latest Lain from preview dev branch tip on Bookworm for glibc compatibility
FROM node:24-bookworm-slim AS lain-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential pkg-config libssl-dev git cmake ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:$PATH"
RUN git clone --depth 1 --branch dev https://github.com/spuentesp/lain.git /lain-build
WORKDIR /lain-build
RUN cargo build --release --bin lain

# Stage 2: Fetch NVIDIA Stack repositories
FROM alpine/git AS repos-fetcher
WORKDIR /repos
RUN git clone --depth 1 https://github.com/NVIDIA/NeMo-Agent-Toolkit.git \
 && git clone --depth 1 https://github.com/NVIDIA/NeMo-Agent-Toolkit-UI.git \
 && git clone --depth 1 https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples.git \
 && git clone --depth 1 https://github.com/NVIDIA/OpenShell.git \
 && git clone --depth 1 https://github.com/NVIDIA/NeMo-Fabric.git \
 && git clone --depth 1 https://github.com/NVIDIA/NemoClaw.git

# Stage 3: Parallax Application + Lain Runtime
FROM node:24-bookworm-slim
ENV CI=true

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl bash \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Copy Lain binary and NVIDIA repos
COPY --from=lain-builder /lain-build/target/release/lain /usr/local/bin/lain
COPY --from=repos-fetcher /repos /repos

# Copy Parallax code and federation configs
COPY . .
COPY deploy/repos.yaml /repos/repos.yaml
COPY deploy/workspaces.yaml /repos/workspaces.yaml

RUN pnpm install --frozen-lockfile \
 && pnpm --filter @parallax/web build

ENV NODE_ENV=production \
    PORT=8080 \
    LAIN_URL=http://127.0.0.1:9999/mcp \
    CLUSTER_A_LAIN_URL=http://127.0.0.1:9999/mcp \
    CLUSTER_B_LAIN_URL=http://127.0.0.1:9999/mcp \
    DATABASE_PATH=/data/parallax.db \
    WEB_BUNDLE_PATH=/app/packages/web/dist

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

RUN chmod +x deploy/docker-entrypoint.sh
CMD ["deploy/docker-entrypoint.sh"]
