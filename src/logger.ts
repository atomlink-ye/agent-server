import { appendFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'

const LOG_DIR = '/tmp/agent-server-logs'
const MAX_LOG_DAYS = 7

let currentDate = ''
let currentLogFile = ''

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true })
}

function getLogFile(): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  if (today !== currentDate) {
    currentDate = today
    currentLogFile = join(LOG_DIR, `agent-server-${today}.log`)
    cleanOldLogs()
  }
  return currentLogFile
}

function cleanOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR).filter(f => f.startsWith('agent-server-') && f.endsWith('.log'))
    if (files.length <= MAX_LOG_DAYS) return
    files.sort()
    const toDelete = files.slice(0, files.length - MAX_LOG_DAYS)
    for (const f of toDelete) {
      try { unlinkSync(join(LOG_DIR, f)) } catch {}
    }
  } catch {}
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function writeToFile(level: string, msg: string): void {
  try {
    const file = getLogFile()
    appendFileSync(file, `${timestamp()} [${level}] ${msg}\n`)
  } catch {}
}

// Monkey-patch console to also write to file
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error

export function initLogger(): void {
  ensureLogDir()

  console.log = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    originalLog(`${timestamp()}`, ...args)
    writeToFile('INFO', msg)
  }

  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    originalWarn(`${timestamp()}`, ...args)
    writeToFile('WARN', msg)
  }

  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    originalError(`${timestamp()}`, ...args)
    writeToFile('ERROR', msg)
  }

  console.log(`[logger] File logging initialized: ${LOG_DIR}/agent-server-YYYY-MM-DD.log (keep ${MAX_LOG_DAYS} days)`)
}
