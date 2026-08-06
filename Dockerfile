FROM node:24.18.0-bookworm-slim AS dependencies

ARG TARGETARCH
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV COREPACK_HOME=/tmp/corepack \
    PNPM_HOME=/pnpm \
    PNPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PATH=/pnpm:/opt/providers/bin:/opt/opencode/bin:$PATH \
    OPENCODE_BIN=/opt/opencode/bin/opencode \
    CLAUDE_CODE_BIN=/opt/providers/bin/claude \
    CODEX_BIN=/opt/providers/bin/codex

WORKDIR /workspace

RUN corepack enable \
    && corepack install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /workspace/.local /workspace/node_modules /workspace/apps/web/node_modules /workspace/dist /home/node/image-node_modules /home/node/image-web-node_modules /opt/opencode/bin /opt/providers/bin \
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
RUN node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFile, writeFile } from 'node:fs/promises'; const hash = createHash('sha256'); for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/web/package.json']) hash.update(await readFile('/workspace/' + file)); const stamp = hash.digest('hex') + '\\n'; await writeFile('/home/node/image-node_modules/.docker-dependencies-stamp', stamp); await writeFile('/home/node/image-web-node_modules/.docker-dependencies-stamp', stamp);"

FROM dependencies AS development

COPY --chown=node:node . .
RUN node scripts/dev/resolve-opencode.mjs --check
