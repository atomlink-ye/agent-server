import { serve } from '@hono/node-server'
import { spawn, execSync, ChildProcess } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { app } from './api/app.js'
import { paseoClient, initPaseoClient } from './paseo-client/singleton.js'

const port = parseInt(process.env.PORT || '3000')
const paseoEnabled = process.env.PASEO_ENABLED !== 'false'

// Resolve API key from various env var formats
function resolveApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  if (process.env.ANTHROPIC_AUTH_TOKEN) return process.env.ANTHROPIC_AUTH_TOKEN
  if (process.env.ANTHROPIC_AUTH_TOKEN_B64) {
    return Buffer.from(process.env.ANTHROPIC_AUTH_TOKEN_B64, 'base64').toString('utf-8')
  }
  return undefined
}

const anthropicApiKey = resolveApiKey()
const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL ||
  (process.env.ANTHROPIC_BEDROCK_BASE_URL?.replace(/\/bedrock$/, '') || undefined)

let paseoProcess: ChildProcess | null = null

const PASEO_USER = 'agent'

function ensureAgentUser(): void {
  try {
    execSync(`id ${PASEO_USER}`, { stdio: 'ignore' })
  } catch {
    execSync(`useradd -m ${PASEO_USER}`, { stdio: 'ignore' })
    console.log(`[agent-server] Created user '${PASEO_USER}'`)
  }
}

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
  // Ensure agent user owns the paseo home
  try {
    execSync(`chown -R ${PASEO_USER}:${PASEO_USER} ${paseoHome}`, { stdio: 'ignore' })
  } catch { /* ignore if chown fails */ }
}

function startPaseoDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const paseoBin = process.env.PASEO_BIN || `${__dirname}/node_modules/.bin/paseo`
    const paseoHome = process.env.PASEO_HOME || '/tmp/.paseo'

    // Ensure non-root user exists for Claude Code compatibility
    ensureAgentUser()

    // Write config.json to disable relay before starting daemon
    ensurePaseoConfig(paseoHome)

    console.log(`[agent-server] Starting Paseo daemon as user '${PASEO_USER}' from: ${paseoBin}`)

    // Build environment for Paseo
    const paseoEnv: Record<string, string> = {
      HOME: `/home/${PASEO_USER}`,
      USER: PASEO_USER,
      PATH: `${__dirname}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`,
      PASEO_LISTEN: process.env.PASEO_LISTEN || '127.0.0.1:6767',
      PASEO_HOME: paseoHome,
      PASEO_RELAY_ENABLED: 'false',
      // Claude Code API config
      ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
      ...(anthropicBaseUrl ? { ANTHROPIC_BASE_URL: anthropicBaseUrl } : {}),
    }

    // Get uid/gid of agent user
    let uid: number | undefined
    let gid: number | undefined
    try {
      uid = parseInt(execSync(`id -u ${PASEO_USER}`, { encoding: 'utf-8' }).trim())
      gid = parseInt(execSync(`id -g ${PASEO_USER}`, { encoding: 'utf-8' }).trim())
    } catch {
      console.warn(`[agent-server] Could not resolve uid/gid for '${PASEO_USER}', running as current user`)
    }

    paseoProcess = spawn(paseoBin, ['daemon', 'start', '--foreground', '--no-relay'], {
      env: paseoEnv,
      uid,
      gid,
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
    console.log(`[agent-server] API config: base_url=${anthropicBaseUrl || 'not set'}, key=${anthropicApiKey ? '***' + anthropicApiKey.slice(-4) : 'not set'}`)
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
