import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

let serverProcess: ChildProcess | null = null

/**
 * E2E setup:
 * - If TEST_BASE_URL is set, tests run against that URL (e.g. Docker deployment)
 * - Otherwise, spawns a local agent-server on port 3001 (requires Paseo on localhost:6767)
 */
export async function setup() {
  const testBaseUrl = process.env.TEST_BASE_URL
  if (testBaseUrl) {
    // External target — just verify it's reachable
    console.log(`\n🎯 Running E2E tests against external: ${testBaseUrl}`)
    const maxWait = 30_000
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(`${testBaseUrl}/api/health`)
        if (res.ok) return
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error(`External server at ${testBaseUrl} not reachable`)
  }

  // Local mode: spawn agent-server
  console.log('\n🚀 Starting local agent-server for E2E tests...')

  serverProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: '3001',
      PASEO_WS_URL: 'ws://localhost:6767/ws',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server failed to start within 20s.\nOutput: ${output}`))
    }, 20_000)

    serverProcess!.stdout?.on('data', (data) => {
      output += data.toString()
      if (data.toString().includes('Listening on port')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    serverProcess!.stderr?.on('data', (data) => {
      output += data.toString()
    })

    serverProcess!.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    serverProcess!.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code}.\nOutput: ${output}`))
      }
    })
  })

  console.log('✅ Agent-server started on port 3001')
}

export async function teardown() {
  if (serverProcess) {
    console.log('\n🛑 Stopping agent-server...')
    serverProcess.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      serverProcess!.on('exit', () => resolve())
      setTimeout(resolve, 5000)
    })
    serverProcess = null
    console.log('✅ Agent-server stopped')
  }
}
