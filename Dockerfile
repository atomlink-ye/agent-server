FROM node:24.18.0-bookworm-slim AS dependencies

ARG TARGETARCH
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV COREPACK_HOME=/tmp/corepack \
    PNPM_HOME=/pnpm \
    PNPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PATH=/pnpm:/opt/providers/bin:/opt/opencode/bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
    OPENCODE_BIN=/opt/opencode/bin/opencode \
    CLAUDE_CODE_BIN=/opt/providers/bin/claude \
    CODEX_BIN=/opt/providers/bin/codex

WORKDIR /workspace

RUN corepack enable \
    && corepack install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /workspace/.local /workspace/node_modules /workspace/apps/web/node_modules /workspace/dist /home/node/image-node_modules /home/node/image-web-node_modules /opt/opencode/bin /opt/providers/bin /opt/playwright-browsers \
    && chown -R node:node /pnpm /workspace /home/node/image-node_modules /home/node/image-web-node_modules /opt/opencode /opt/providers

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) opencode_package=opencode-linux-arm64 ;; \
      amd64) opencode_package=opencode-linux-x64 ;; \
      *) echo "Unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    opencode_version="$(OPENCODE_PACKAGE="$opencode_package" node --input-type=module -e "import { readFile } from 'node:fs/promises'; const packageJson = JSON.parse(await readFile('/workspace/package.json', 'utf8')); process.stdout.write(packageJson.optionalDependencies?.[process.env.OPENCODE_PACKAGE] ?? '')")"; \
    test -n "$opencode_version"; \
    npm install --prefix /opt/opencode --no-save --ignore-scripts "$opencode_package@$opencode_version"; \
    ln -sfn "../node_modules/$opencode_package/bin/opencode" /opt/opencode/bin/opencode; \
    /opt/opencode/bin/opencode --version
# Claude Code and Codex CLIs. Paseo spawns the provider binary from inside this
# image, so a mixed-provider Team needs all three present, not just opencode.
# Versions are ARGs so a build can pin them; the check below fails the build if a
# binary did not land, because a missing provider otherwise surfaces much later
# as "Provider <name> is not available" at Team runtime.
ARG CLAUDE_CODE_VERSION=2.1.223
ARG CODEX_VERSION=0.146.1
RUN set -eu; \
    npm install -g --prefix /opt/providers \
      "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" "@openai/codex@$CODEX_VERSION"; \
    /opt/providers/bin/claude --version; \
    /opt/providers/bin/codex --version
RUN cp -a /workspace/node_modules/. /home/node/image-node_modules/ \
    && cp -a /workspace/apps/web/node_modules/. /home/node/image-web-node_modules/
COPY --chown=node:node scripts/dev/dependency-stamp.mjs ./scripts/dev/dependency-stamp.mjs
RUN node scripts/dev/dependency-stamp.mjs /workspace > /home/node/image-node_modules/.docker-dependencies-stamp \
    && cp /home/node/image-node_modules/.docker-dependencies-stamp /home/node/image-web-node_modules/.docker-dependencies-stamp

# Two things the slim base omits that only bite at runtime, both masked for a
# long time because the smoke suite only ever exercised the opencode provider.
#
# procps: the Paseo daemon shells out to `ps` to reap agent child processes, so
# that spawn raises ENOENT as an *uncaught* exception and the daemon dies,
# taking scripts/dev/with-paseo.mjs and the container with it. Surfaces as
# "Paseo did not become healthy" long after a healthy start.
#
# ca-certificates: codex is a Rust binary and reads the system trust store,
# which is empty here, so *every* HTTPS request fails with "error sending
# request for url". Claude Code and opencode are Node and ship their own root
# store, which is why only the codex provider is affected — a mixed-provider
# Team cannot work at all without this.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps ca-certificates python3 \
    && update-ca-certificates \
    && ps --version \
    && python3 --version \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && rm -rf /var/lib/apt/lists/*
USER node

FROM dependencies AS development

COPY --chown=node:node . .
RUN node scripts/dev/resolve-opencode.mjs --check

# Browser stage. `playwright install --with-deps` pulls a chromium shell plus
# dozens of apt packages, and it is the single most expensive layer in this
# image — on a fuse-overlayfs host it dominates total build time. Only the
# browser-driven suites need it (`vitest.web.config.ts` runs vitest in browser
# mode via playwright, and `test:e2e:web`), so it lives in its own stage and
# every backend target builds without it.
#
# Consequence, on purpose: with the default `development` target,
# `pnpm test:web` / `test:e2e:web` — and therefore `pnpm test` and `pnpm run ci`,
# which include them — cannot run. Build with `--target web-testing`
# (or `docker compose build --build-arg`/service override) when you need them.
FROM development AS web-testing

USER root
RUN apt-get update \
    && pnpm exec playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /opt/playwright-browsers \
    && rm -rf /var/lib/apt/lists/*
USER node
