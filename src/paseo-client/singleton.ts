import { PaseoClient } from './index.js'

const paseoWsUrl = process.env.PASEO_WS_URL || 'ws://localhost:6767/ws'

export const paseoClient = new PaseoClient(paseoWsUrl)

// Prevent unhandled 'error' event from crashing the process
paseoClient.on('error', (err) => {
  console.error(`[PaseoClient] Error: ${err.message}`)
})

export async function initPaseoClient(): Promise<void> {
  const maxRetries = 10
  const retryDelay = 3000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await paseoClient.connect()
      console.log(`[agent-server] Connected to Paseo at ${paseoWsUrl}`)
      return
    } catch (err: any) {
      console.warn(`[agent-server] Connect attempt ${attempt}/${maxRetries} failed: ${err.message}`)
      if (attempt === maxRetries) throw err
      await new Promise(r => setTimeout(r, retryDelay))
    }
  }
}
