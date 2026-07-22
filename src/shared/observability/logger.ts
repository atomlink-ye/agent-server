export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogAttributes = Readonly<Record<string, unknown>>;

export interface Logger {
  log(level: LogLevel, event: string, attributes?: LogAttributes): void;
}

export interface LoggerOptions {
  readonly service: string;
  readonly minimumLevel: LogLevel;
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

const levelPriority: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions): Logger {
  const write =
    options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  return {
    log(level, event, attributes = {}) {
      if (levelPriority[level] < levelPriority[options.minimumLevel]) {
        return;
      }

      write(
        JSON.stringify({
          timestamp: now().toISOString(),
          level,
          service: options.service,
          event,
          ...attributes,
        }),
      );
    },
  };
}
