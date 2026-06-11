import { serve } from '@hono/node-server'
import { spawn, execSync, ChildProcess } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync, readdirSync, symlinkSync } from 'fs'
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

function ensureLarkCliConfig(): void {
  const appId = process.env.LARK_APP_ID
  const appSecret = process.env.LARK_APP_SECRET
  if (!appId || !appSecret) {
    console.log('[agent-server] LARK_APP_ID/LARK_APP_SECRET not set, skipping lark-cli config')
    return
  }
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const larkCliBin = `${__dirname}/node_modules/.bin/lark-cli`
  if (!existsSync(larkCliBin)) {
    console.warn('[agent-server] lark-cli binary not found, skipping config')
    return
  }
  const agentHome = `/home/${PASEO_USER}`
  try {
    execSync(`echo "${appSecret}" | su - ${PASEO_USER} -s /bin/bash -c "HOME=${agentHome} ${larkCliBin} config init --app-id ${appId} --app-secret-stdin --brand lark"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    })
    console.log(`[agent-server] lark-cli configured for app ${appId}`)
  } catch (e: any) {
    console.warn(`[agent-server] lark-cli config init: ${e.stderr?.toString().trim() || e.message}`)
  }
}

function ensureLarkSkills(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const skillsSource = `${__dirname}/.agent-skills`
  if (!existsSync(skillsSource)) {
    console.log('[agent-server] No .agent-skills directory found, skipping skills setup')
    return
  }
  const agentHome = `/home/${PASEO_USER}`
  const claudeSkillsDir = `${agentHome}/.claude/skills`
  mkdirSync(claudeSkillsDir, { recursive: true })

  const skills = readdirSync(skillsSource)
  let installed = 0
  for (const skill of skills) {
    const target = `${claudeSkillsDir}/${skill}`
    const source = `${skillsSource}/${skill}`
    if (!existsSync(target)) {
      try {
        symlinkSync(source, target)
        installed++
      } catch { /* ignore */ }
    }
  }
  // Ensure agent user owns the .claude directory
  try {
    execSync(`chown -R ${PASEO_USER}:${PASEO_USER} ${agentHome}/.claude`, { stdio: 'ignore' })
  } catch { /* ignore */ }
  if (installed > 0) {
    console.log(`[agent-server] Installed ${installed} lark skills to ${claudeSkillsDir}`)
  }
}

function startPaseoDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const paseoBin = process.env.PASEO_BIN || `${__dirname}/node_modules/.bin/paseo`
    const paseoHome = process.env.PASEO_HOME || '/tmp/.paseo'

    // Ensure non-root user exists for Claude Code compatibility
    ensureAgentUser()

    // Configure lark-cli with app credentials and set up skills
    ensureLarkCliConfig()
    ensureLarkSkills()

    // Write config.json to disable relay before starting daemon
    ensurePaseoConfig(paseoHome)

    console.log(`[agent-server] Starting Paseo daemon as user '${PASEO_USER}' from: ${paseoBin}`)

    // Build environment for Paseo: inherit process.env, then override with Paseo-specific values
    const paseoEnv: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null) as [string, string][]),
      HOME: `/home/${PASEO_USER}`,
      USER: PASEO_USER,
      PATH: `${__dirname}:${__dirname}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`,
      PASEO_LISTEN: process.env.PASEO_LISTEN || '127.0.0.1:6767',
      PASEO_HOME: paseoHome,
      PASEO_RELAY_ENABLED: 'false',
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
