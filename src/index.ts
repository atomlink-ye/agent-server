import { serve } from '@hono/node-server'
import { spawn, ChildProcess } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { app } from './api/app.js'
import { paseoClient, initPaseoClient } from './paseo-client/singleton.js'

const port = parseInt(process.env.PORT || '3000')
const paseoEnabled = process.env.PASEO_ENABLED !== 'false'

// Decode Base64-encoded auth token if provided
function resolveAuthToken(): string | undefined {
  if (process.env.ANTHROPIC_AUTH_TOKEN) return process.env.ANTHROPIC_AUTH_TOKEN
  if (process.env.ANTHROPIC_AUTH_TOKEN_B64) {
    return Buffer.from(process.env.ANTHROPIC_AUTH_TOKEN_B64, 'base64').toString('utf-8')
  }
  return undefined
}

const anthropicAuthToken = resolveAuthToken()
const anthropicBedrockBaseUrl = process.env.ANTHROPIC_BEDROCK_BASE_URL

let paseoProcess: ChildProcess | null = null

function ensurePaseoConfig(paseoHome: string): void {
  mkdirSync(paseoHome, { recursive: true })
  const configPath = `${paseoHome}/config.json`
  if (!existsSync(configPath)) {
    const config = {
      daemon: {
        relay: { enabled: false },
      },
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
    console.log(`[agent-server] Created Paseo config at ${configPath} (relay disabled)`)
  }
}

function startPaseoDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // Look for paseo binary in node_modules/.bin/
    const paseoBin = process.env.PASEO_BIN || `${__dirname}/node_modules/.bin/paseo`
    const paseoHome = process.env.PASEO_HOME || '/tmp/.paseo'

    // Write config.json to disable relay before starting daemon
    ensurePaseoConfig(paseoHome)

    console.log(`[agent-server] Starting Paseo daemon from: ${paseoBin}`)

    paseoProcess = spawn(paseoBin, ['daemon', 'start', '--foreground', '--no-relay'], {
      env: {
        ...process.env,
        PASEO_LISTEN: process.env.PASEO_LISTEN || '127.0.0.1:6767',
        PASEO_HOME: paseoHome,
        PASEO_RELAY_ENABLED: 'false',
        // Claude Code Bedrock mode (LiteLLM proxy)
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
        ...(anthropicAuthToken ? { ANTHROPIC_AUTH_TOKEN: anthropicAuthToken } : {}),
        ...(anthropicBedrockBaseUrl ? { ANTHROPIC_BEDROCK_BASE_URL: anthropicBedrockBaseUrl } : {}),
        ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'qa.fiat.chat.cloudways.default.sonnet-4-6',
        ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'qa.fiat.chat.cloudways.default.opus-4-6',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'qa.fiat.chat.cloudways.default.haiku-4-5',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    paseoProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[paseo] ${data.toString().trim()}`)
    })

    paseoProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[paseo] ${data.toString().trim()}`)
    })

    paseoProcess.on('error', (err) => {
      console.error(`[agent-server] Failed to start Paseo daemon: ${err.message}`)
      reject(err)
    })

    paseoProcess.on('exit', (code) => {
      console.warn(`[agent-server] Paseo daemon exited with code ${code}`)
      paseoProcess = null
    })

    // Wait for Paseo to be ready (poll health endpoint)
    let attempts = 0
    const maxAttempts = 30
    const check = setInterval(async () => {
      attempts++
      try {
        const res = await fetch('http://127.0.0.1:6767/api/health')
        if (res.ok) {
          clearInterval(check)
          console.log('[agent-server] Paseo daemon is healthy')
          resolve()
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(check)
          reject(new Error('Paseo daemon failed to become healthy within 30s'))
        }
      }
    }, 1000)
  })
}

async function main() {
  // Start HTTP server immediately so health checks pass
  serve({ fetch: app.fetch, port })
  console.log(`[agent-server] Listening on port ${port}`)

  if (!paseoEnabled) {
    console.log('[agent-server] Paseo disabled by PASEO_ENABLED=false')
  } else {
    console.log(`[agent-server] Claude Code config: bedrock_url=${anthropicBedrockBaseUrl || 'not set'}, auth_token=${anthropicAuthToken ? '***' + anthropicAuthToken.slice(-4) : 'not set'}`)
    // Start Paseo daemon, then connect client
    try {
      await startPaseoDaemon()
      await initPaseoClient()
      console.log('[agent-server] Connected to Paseo successfully')
    } catch (err) {
      console.warn('[agent-server] Paseo unavailable, running without it:', (err as Error).message)
      paseoClient.disconnect()
    }
  }

  const shutdown = async () => {
    console.log('[agent-server] Shutting down...')
    paseoClient.disconnect()
    if (paseoProcess) {
      paseoProcess.kill('SIGTERM')
    }
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(console.error)
