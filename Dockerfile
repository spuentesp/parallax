# Parallax demo image: API + built web bundle in one container.
# Lain (the analysis engine) runs OUTSIDE this image and is reached over HTTP
# (LAIN_URL / the workspace's lainUrl). See deploy/RUNBOOK.md.
FROM node:24-bookworm-slim
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @parallax/web build
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/parallax.db \
    WEB_BUNDLE_PATH=/app/packages/web/dist
VOLUME /data
EXPOSE 8080
# The shared package is TypeScript source, so the API runs through tsx.
CMD ["pnpm", "--filter", "@parallax/api", "exec", "tsx", "src/index.ts"]
