import { resolve } from 'node:path';

import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SERVICE_NAME: z.string().min(1).default('agent-server'),
  PASEO_WS_URL: z.url().default('ws://127.0.0.1:6767/ws'),
  PASEO_AGENT_CWD: z.string().min(1).default('.local/agent-workspace'),
  PASEO_WORKSPACE_TITLE: z.string().min(1).default('Agent Server Baseline'),
  PASEO_MODEL: z.string().trim().min(1).optional(),
  PASEO_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000),
  PASEO_EXECUTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(120_000),
});

export type AppConfig = Readonly<{
  nodeEnv: z.infer<typeof ConfigSchema>['NODE_ENV'];
  host: string;
  port: number;
  logLevel: z.infer<typeof ConfigSchema>['LOG_LEVEL'];
  serviceName: string;
  paseo: {
    wsUrl: string;
    agentCwd: string;
    workspaceTitle: string;
    model?: string;
    connectTimeoutMs: number;
    executionTimeoutMs: number;
  };
}>;

export class ConfigurationError extends Error {
  public constructor(issues: readonly z.core.$ZodIssue[]) {
    const details = issues
      .map(
        (issue) =>
          `${issue.path.join('.') || 'configuration'}: ${issue.message}`,
      )
      .join('; ');
    super(`Invalid configuration: ${details}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory: string = process.cwd(),
): AppConfig {
  const parsed = ConfigSchema.safeParse(environment);

  if (!parsed.success) {
    throw new ConfigurationError(parsed.error.issues);
  }

  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    serviceName: parsed.data.SERVICE_NAME,
    paseo: {
      wsUrl: parsed.data.PASEO_WS_URL,
      agentCwd: resolve(workingDirectory, parsed.data.PASEO_AGENT_CWD),
      workspaceTitle: parsed.data.PASEO_WORKSPACE_TITLE,
      ...(parsed.data.PASEO_MODEL ? { model: parsed.data.PASEO_MODEL } : {}),
      connectTimeoutMs: parsed.data.PASEO_CONNECT_TIMEOUT_MS,
      executionTimeoutMs: parsed.data.PASEO_EXECUTION_TIMEOUT_MS,
    },
  });
}
