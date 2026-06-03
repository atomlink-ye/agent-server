import { serve } from '@hono/node-server'
import { spawn, ChildProcess } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { app } from './api/app.js'
import { paseoClient, initPaseoClient } from './paseo-client/singleton.js'

const port = parseInt(process.env.PORT || '3000')
const paseoEnabled = process.env.PASEO_ENABLED !== 'false'

let paseoProcess: ChildProcess | null = null

function startPaseoDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // Look for paseo binary in node_modules/.bin/
    const paseoBin = process.env.PASEO_BIN || `${__dirname}/node_modules/.bin/paseo`

    console.log(`[agent-server] Starting Paseo daemon from: ${paseoBin}`)

    paseoProcess = spawn(paseoBin, ['daemon', 'start', '--foreground', '--no-relay'], {
      env: {
        ...process.env,
        PASEO_LISTEN: process.env.PASEO_LISTEN || '127.0.0.1:6767',
        PASEO_HOME: process.env.PASEO_HOME || '/tmp/.paseo',
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
