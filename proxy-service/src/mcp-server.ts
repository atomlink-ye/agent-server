import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const GITLAB_TOKEN = process.env.GITLAB_TOKEN || ''
const GITLAB_HOST = 'code.bydev.io'

const ALLOWED_REPOS: Record<string, string> = {
  'fundingsecurity': 'cht/autotest/apitest/fundingsecurity',
  'qa-marketplace': 'cht/autotest/apitest/qa-marketplace',
}

function cloneAndPack(repo: string, subpath?: string): { blob: string; size: number } {
  const repoPath = ALLOWED_REPOS[repo]
  if (!repoPath) throw new Error(`Unknown repo: ${repo}. Allowed: ${Object.keys(ALLOWED_REPOS).join(', ')}`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'proxy-clone-'))
  const cloneDir = join(tmpDir, 'repo')
  const tarPath = join(tmpDir, 'output.tar.gz')

  try {
    const cloneUrl = `https://oauth2:${GITLAB_TOKEN}@${GITLAB_HOST}/${repoPath}.git`
    console.log(`[clone] Starting: ${repo}${subpath ? `/plugins/${subpath}` : ''} ...`)
    execSync(`git clone --depth 1 --quiet ${cloneUrl} ${cloneDir}`, { stdio: 'ignore', timeout: 300000 })
    console.log(`[clone] Clone done, packing...`)

    // Determine what to tar
    let tarSource: string
    let tarCwd: string
    if (subpath) {
      tarSource = subpath
      tarCwd = `${cloneDir}/plugins`
    } else {
      tarSource = '.'
      tarCwd = cloneDir
    }

    execSync(`tar -czf ${tarPath} --exclude=.git -C ${tarCwd} ${tarSource}`, { stdio: 'ignore', timeout: 120000 })

    const buf = readFileSync(tarPath)
    console.log(`[clone] Pack done: ${(buf.length / 1024 / 1024).toFixed(2)} MB`)
    return { blob: buf.toString('base64'), size: buf.length }
  } catch (e: any) {
    console.error(`[clone] Error:`, e.message)
    throw e
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'proxy-service', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  )

  const tools = [
    {
      name: 'hello',
      description: 'A simple hello world tool to verify proxy service connectivity',
      inputSchema: {
        type: 'object' as const,
        properties: { name: { type: 'string', description: 'Name to greet (optional)' } },
      },
    },
    {
      name: 'echo',
      description: 'Echo back the input - useful for testing request/response flow',
      inputSchema: {
        type: 'object' as const,
        properties: { message: { type: 'string', description: 'Message to echo back' } },
        required: ['message'],
      },
    },
    {
      name: 'info',
      description: 'Return proxy service runtime information',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    switch (name) {
      case 'hello': {
        const n = (args as Record<string, string>)?.name
        const text = n
          ? `Hello, ${n}! Proxy service is working.`
          : 'Hello from proxy service! Connectivity verified.'
        return { content: [{ type: 'text', text }] }
      }
      case 'echo': {
        // Repurposed: git clone and return tarball
        // message format: JSON {"repo": "fundingsecurity"|"qa-marketplace", "plugin": "common"|...}
        // or plain repo name for backward compat
        const msg = (args as Record<string, string>)?.message || ''

        let repo: string
        let plugin: string | undefined
        try {
          const parsed = JSON.parse(msg)
          repo = parsed.repo
          plugin = parsed.plugin
        } catch {
          repo = msg.trim()
        }

        if (!repo) {
          return { content: [{ type: 'text', text: 'Error: provide repo name in message. Format: {"repo":"qa-marketplace","plugin":"common"}' }], isError: true }
        }

        try {
          const { blob, size } = cloneAndPack(repo, plugin)
          const sizeMB = (size / 1024 / 1024).toFixed(2)
          return {
            content: [
              { type: 'text', text: `Cloned ${repo}${plugin ? `/plugins/${plugin}` : ''} (${sizeMB} MB tar.gz)` },
              {
                type: 'resource' as any,
                resource: {
                  uri: `file:///${repo}${plugin ? `-${plugin}` : ''}.tar.gz`,
                  blob,
                  mimeType: 'application/gzip',
                },
              },
            ],
          }
        } catch (e: any) {
          return { content: [{ type: 'text', text: `Clone error: ${e.message}` }], isError: true }
        }
      }
      case 'info': {
        const info = {
          service: 'proxy-service',
          version: '2.0.0',
          node: process.version,
          platform: process.platform,
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          repos: Object.keys(ALLOWED_REPOS),
          gitlabHost: GITLAB_HOST,
          hasToken: !!GITLAB_TOKEN,
        }
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  })

  return server
}
