import { serve } from '@hono/node-server'
import { app } from './api/app.js'
import { paseoClient, initPaseoClient } from './paseo-client/singleton.js'

const port = parseInt(process.env.PORT || '3000')

async function main() {
  await initPaseoClient()

  serve({ fetch: app.fetch, port })
  console.log(`[agent-server] Listening on port ${port}`)

  const shutdown = async () => {
    console.log('[agent-server] Shutting down...')
    paseoClient.disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(console.error)
