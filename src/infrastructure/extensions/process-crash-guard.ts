import type { Logger } from '../../shared/observability/logger.js';

let installed = false;
let activeLogger: Logger | undefined;

/**
 * Keep recoverable process-level async faults observable without exposing the
 * rejected value, which may contain credentials, SQL, or local paths.
 *
 * This guard cannot catch fatal signals or resource exhaustion. It only keeps
 * the Node process alive for errors represented by these two events.
 */
export function installProcessCrashGuards(logger?: Logger): void {
  if (logger) activeLogger = logger;
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', () => {
    report(activeLogger, 'process.unhandled_rejection');
  });
  process.on('uncaughtException', () => {
    report(activeLogger, 'process.uncaught_exception');
  });
}

function report(logger: Logger | undefined, event: string): void {
  try {
    if (logger) {
      logger.log('error', event);
      return;
    }
  } catch {
    // Fall through to a minimal message if the application logger is itself
    // unavailable while handling a process-level fault.
  }
  try {
    process.stderr.write(`${event}\n`);
  } catch {
    // There is no safe recovery action left if stderr is unavailable.
  }
}
