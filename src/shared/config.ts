import { resolve } from 'node:path';

import { z } from 'zod';

import {
  MANAGED_ENVIRONMENT_PROVIDERS,
  type ManagedEnvironmentProvider,
} from '../domain/environments/managed-environment-package.js';
import type { ServiceAccountRecord } from '../application/control-plane/service-account-authenticator.js';

export type LarkCanaryEnabledConfig = Readonly<{
  enabled: true;
  connectionKey: string;
  appId: string;
  domain: 'feishu' | 'lark';
  appSecret: string;
  botOpenId: string;
  allowedChatId: string;
  allowedOpenId: string;
  tenantId: string;
  workspaceId: string;
  serviceAccountId: string;
  publishedAgentVersionId: string;
  policyVersion: string;
  docWebBaseUrl?: string;
}>;

export type LarkCanaryConfig =
  Readonly<{ enabled: false }> | LarkCanaryEnabledConfig;

const OptionalConfigString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const BooleanEnvironment = z.preprocess((value) => {
  if (value === undefined || value === '') return false;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

const ServiceAccountSchema = z.object({
  serviceAccountId: z.string().trim().min(1),
  token: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
  disabled: z.boolean().default(false),
});

const ServiceAccountsEnvironmentSchema = z
  .string()
  .optional()
  .transform((value, context): unknown => {
    if (value === undefined || value.trim() === '') {
      return [];
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'must be valid JSON',
      });
      return z.NEVER;
    }
  })
  .pipe(
    z.array(ServiceAccountSchema).superRefine((accounts, context) => {
      const tokenIndexes = new Map<string, number>();
      const serviceAccountScopes = new Map<
        string,
        {
          readonly tenantId: string;
          readonly workspaceId: string;
        }
      >();

      for (const [index, account] of accounts.entries()) {
        const duplicateTokenIndex = tokenIndexes.get(account.token);
        if (duplicateTokenIndex !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [index, 'token'],
            message: `duplicate service-account token is not allowed: ${account.token}`,
          });
        } else {
          tokenIndexes.set(account.token, index);
        }

        const existingScope = serviceAccountScopes.get(
          account.serviceAccountId,
        );
        if (!existingScope) {
          serviceAccountScopes.set(account.serviceAccountId, {
            tenantId: account.tenantId,
            workspaceId: account.workspaceId,
          });
          continue;
        }

        const hasConflictingOwnerScope =
          existingScope.tenantId !== account.tenantId ||
          existingScope.workspaceId !== account.workspaceId;

        if (hasConflictingOwnerScope) {
          context.addIssue({
            code: 'custom',
            path: [index, 'serviceAccountId'],
            message: `conflicting service-account id binding across different owner scopes is not allowed: ${account.serviceAccountId}`,
          });
        }
      }
    }),
  );

const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    SERVICE_NAME: z.string().min(1).default('agent-server'),
    // The legacy provider switch was ambiguous about which product surface it
    // enabled. Reject it instead of silently accepting a second declaration.
    CHAT_TURN_PROVIDER: z
      .never({
        error:
          'has been replaced by AGENT_SERVER_DIRECT_CHAT_PLANE (absent|mock|execution_runtime). Remove CHAT_TURN_PROVIDER from your environment/compose.',
      })
      .optional(),
    AGENT_SERVER_DIRECT_CHAT_PLANE: z
      .enum(['absent', 'mock', 'execution_runtime'])
      .default('execution_runtime'),
    AGENT_SERVER_PRODUCT_WORK_PLANE: z
      .enum(['absent', 'execution_runtime'])
      .default('execution_runtime'),
    RUNTIME_ADAPTER: z.enum(['none', 'paseo']).default('paseo'),
    RUNTIME_MCP_LISTEN_HOST: z.string().min(1).default('127.0.0.1'),
    RUNTIME_MCP_ADVERTISED_HOST: z.string().min(1).default('127.0.0.1'),
    PASEO_WS_URL: z.url().default('ws://127.0.0.1:6767/ws'),
    PASEO_PROVIDER: z.enum(MANAGED_ENVIRONMENT_PROVIDERS).default('opencode'),
    PASEO_AGENT_CWD: z.string().min(1).default('.local/agent-workspace'),
    PASEO_RUNTIME_CELL_ROOT: z.string().min(1).default('.local/runtime-cells'),
    AGENT_SERVER_SKILL_REGISTRY_ROOT: z
      .string()
      .min(1)
      .default('.local/skill-registry'),
    PASEO_WORKSPACE_TITLE: z.string().min(1).default('Agent Server Baseline'),
    PASEO_MODEL: z.string().trim().min(1).optional(),
    PASEO_CONNECT_TIMEOUT_MS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().int().min(100).max(60_000).default(10_000),
    ),
    PASEO_EXECUTION_TIMEOUT_MS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().int().min(1_000).max(600_000).default(150_000),
    ),
    // This is a coarse upper bound for a stuck daemon RPC, not a latency
    // tuning knob; keep it at least twice the execution timeout.
    PASEO_SESSION_RPC_TIMEOUT_MS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER)
        .default(300_000),
    ),
    AGENT_SERVER_DISPATCHER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .default(4),
    AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED:
      BooleanEnvironment.default(false),
    SERVICE_ACCOUNTS_JSON: ServiceAccountsEnvironmentSchema,
    LARK_CANARY_ENABLED: BooleanEnvironment.default(false),
    LARK_CANARY_CONNECTION_KEY: OptionalConfigString,
    LARK_CANARY_APP_ID: OptionalConfigString,
    LARK_CANARY_DOMAIN: z.enum(['feishu', 'lark']).optional(),
    LARK_CANARY_APP_SECRET: OptionalConfigString,
    LARK_CANARY_BOT_OPEN_ID: OptionalConfigString,
    LARK_CANARY_ALLOWED_CHAT_ID: OptionalConfigString,
    LARK_CANARY_ALLOWED_OPEN_ID: OptionalConfigString,
    LARK_CANARY_TENANT_ID: OptionalConfigString,
    LARK_CANARY_WORKSPACE_ID: OptionalConfigString,
    LARK_CANARY_SERVICE_ACCOUNT_ID: OptionalConfigString,
    LARK_CANARY_PUBLISHED_AGENT_VERSION_ID: OptionalConfigString,
    LARK_CANARY_POLICY_VERSION: OptionalConfigString,
    LARK_CANARY_DOC_WEB_BASE_URL: z.url().optional(),
  })
  .superRefine((config, context) => {
    if (!config.LARK_CANARY_ENABLED) return;

    const requiredFields = [
      ['LARK_CANARY_CONNECTION_KEY', config.LARK_CANARY_CONNECTION_KEY],
      ['LARK_CANARY_APP_ID', config.LARK_CANARY_APP_ID],
      ['LARK_CANARY_DOMAIN', config.LARK_CANARY_DOMAIN],
      ['LARK_CANARY_APP_SECRET', config.LARK_CANARY_APP_SECRET],
      ['LARK_CANARY_BOT_OPEN_ID', config.LARK_CANARY_BOT_OPEN_ID],
      ['LARK_CANARY_ALLOWED_CHAT_ID', config.LARK_CANARY_ALLOWED_CHAT_ID],
      ['LARK_CANARY_ALLOWED_OPEN_ID', config.LARK_CANARY_ALLOWED_OPEN_ID],
      ['LARK_CANARY_TENANT_ID', config.LARK_CANARY_TENANT_ID],
      ['LARK_CANARY_WORKSPACE_ID', config.LARK_CANARY_WORKSPACE_ID],
      ['LARK_CANARY_SERVICE_ACCOUNT_ID', config.LARK_CANARY_SERVICE_ACCOUNT_ID],
      [
        'LARK_CANARY_PUBLISHED_AGENT_VERSION_ID',
        config.LARK_CANARY_PUBLISHED_AGENT_VERSION_ID,
      ],
      ['LARK_CANARY_POLICY_VERSION', config.LARK_CANARY_POLICY_VERSION],
    ] as const;
    for (const [path, value] of requiredFields) {
      if (!value) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: 'is required when Lark canary is enabled',
        });
      }
    }

    const account = config.SERVICE_ACCOUNTS_JSON.find(
      (candidate) =>
        candidate.serviceAccountId === config.LARK_CANARY_SERVICE_ACCOUNT_ID,
    );
    if (!account) {
      context.addIssue({
        code: 'custom',
        path: ['LARK_CANARY_SERVICE_ACCOUNT_ID'],
        message: 'must reference a configured service account',
      });
      return;
    }
    if (account.disabled) {
      context.addIssue({
        code: 'custom',
        path: ['LARK_CANARY_SERVICE_ACCOUNT_ID'],
        message: 'must reference an enabled service account',
      });
    }
    if (account.tenantId !== config.LARK_CANARY_TENANT_ID) {
      context.addIssue({
        code: 'custom',
        path: ['LARK_CANARY_TENANT_ID'],
        message: 'must match the service account tenant',
      });
    }
    if (account.workspaceId !== config.LARK_CANARY_WORKSPACE_ID) {
      context.addIssue({
        code: 'custom',
        path: ['LARK_CANARY_WORKSPACE_ID'],
        message: 'must match the service account workspace',
      });
    }
    if (account.policyVersion !== config.LARK_CANARY_POLICY_VERSION) {
      context.addIssue({
        code: 'custom',
        path: ['LARK_CANARY_POLICY_VERSION'],
        message: 'must match the service account policy',
      });
    }
  });

export type AppConfig = Readonly<{
  nodeEnv: z.infer<typeof ConfigSchema>['NODE_ENV'];
  host: string;
  port: number;
  logLevel: z.infer<typeof ConfigSchema>['LOG_LEVEL'];
  serviceName: string;
  /** Explicit Direct Chat bridge declaration; this does not cover generic Runs/Tasks. */
  directChatPlane: z.infer<
    typeof ConfigSchema
  >['AGENT_SERVER_DIRECT_CHAT_PLANE'];
  /** Explicit Product Work declaration; this does not cover generic Runs/Tasks/Sessions/Team execution. */
  productWorkPlane: z.infer<
    typeof ConfigSchema
  >['AGENT_SERVER_PRODUCT_WORK_PLANE'];
  runtime?: {
    adapter: z.infer<typeof ConfigSchema>['RUNTIME_ADAPTER'];
  };
  runtimeMcp?: {
    listenHost: string;
    advertisedHost: string;
  };
  teamCompletionApprovalRequired: boolean;
  serviceAccounts?: readonly ServiceAccountRecord[];
  larkCanary?: LarkCanaryConfig;
  skillRegistryRoot: string;
  dispatcher?: {
    concurrency: number;
  };
  paseo: {
    wsUrl: string;
    provider: ManagedEnvironmentProvider;
    agentCwd: string;
    runtimeCellRoot?: string;
    workspaceTitle: string;
    model?: string;
    connectTimeoutMs: number;
    connectTimeoutSource: 'env' | 'default';
    executionTimeoutMs: number;
    executionTimeoutSource: 'env' | 'default';
    sessionRpcTimeoutMs: number;
    sessionRpcTimeoutSource: 'env' | 'default';
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
  const connectTimeoutSource: 'env' | 'default' =
    environment.PASEO_CONNECT_TIMEOUT_MS?.trim() ? 'env' : 'default';
  const executionTimeoutSource: 'env' | 'default' =
    environment.PASEO_EXECUTION_TIMEOUT_MS?.trim() ? 'env' : 'default';
  const sessionRpcTimeoutSource: 'env' | 'default' =
    environment.PASEO_SESSION_RPC_TIMEOUT_MS?.trim() ? 'env' : 'default';
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
    directChatPlane: parsed.data.AGENT_SERVER_DIRECT_CHAT_PLANE,
    productWorkPlane: parsed.data.AGENT_SERVER_PRODUCT_WORK_PLANE,
    runtime: {
      adapter: parsed.data.RUNTIME_ADAPTER,
    },
    runtimeMcp: {
      listenHost: parsed.data.RUNTIME_MCP_LISTEN_HOST,
      advertisedHost: parsed.data.RUNTIME_MCP_ADVERTISED_HOST,
    },
    teamCompletionApprovalRequired:
      parsed.data.AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED,
    serviceAccounts: Object.freeze(
      parsed.data.SERVICE_ACCOUNTS_JSON.map((account) =>
        Object.freeze({ ...account }),
      ),
    ),
    larkCanary: parsed.data.LARK_CANARY_ENABLED
      ? Object.freeze({
          enabled: true as const,
          connectionKey: requiredConfig(parsed.data.LARK_CANARY_CONNECTION_KEY),
          appId: requiredConfig(parsed.data.LARK_CANARY_APP_ID),
          domain: requiredConfig(parsed.data.LARK_CANARY_DOMAIN) as
            'feishu' | 'lark',
          appSecret: requiredConfig(parsed.data.LARK_CANARY_APP_SECRET),
          botOpenId: requiredConfig(parsed.data.LARK_CANARY_BOT_OPEN_ID),
          allowedChatId: requiredConfig(
            parsed.data.LARK_CANARY_ALLOWED_CHAT_ID,
          ),
          allowedOpenId: requiredConfig(
            parsed.data.LARK_CANARY_ALLOWED_OPEN_ID,
          ),
          tenantId: requiredConfig(parsed.data.LARK_CANARY_TENANT_ID),
          workspaceId: requiredConfig(parsed.data.LARK_CANARY_WORKSPACE_ID),
          serviceAccountId: requiredConfig(
            parsed.data.LARK_CANARY_SERVICE_ACCOUNT_ID,
          ),
          publishedAgentVersionId: requiredConfig(
            parsed.data.LARK_CANARY_PUBLISHED_AGENT_VERSION_ID,
          ),
          policyVersion: requiredConfig(parsed.data.LARK_CANARY_POLICY_VERSION),
          ...(parsed.data.LARK_CANARY_DOC_WEB_BASE_URL
            ? { docWebBaseUrl: parsed.data.LARK_CANARY_DOC_WEB_BASE_URL }
            : {}),
        })
      : Object.freeze({ enabled: false as const }),
    skillRegistryRoot: resolve(
      workingDirectory,
      parsed.data.AGENT_SERVER_SKILL_REGISTRY_ROOT,
    ),
    dispatcher: {
      concurrency: parsed.data.AGENT_SERVER_DISPATCHER_CONCURRENCY,
    },
    paseo: {
      wsUrl: parsed.data.PASEO_WS_URL,
      provider: parsed.data.PASEO_PROVIDER,
      agentCwd: resolve(workingDirectory, parsed.data.PASEO_AGENT_CWD),
      runtimeCellRoot: resolve(
        workingDirectory,
        parsed.data.PASEO_RUNTIME_CELL_ROOT,
      ),
      workspaceTitle: parsed.data.PASEO_WORKSPACE_TITLE,
      ...(parsed.data.PASEO_MODEL ? { model: parsed.data.PASEO_MODEL } : {}),
      connectTimeoutMs: parsed.data.PASEO_CONNECT_TIMEOUT_MS,
      connectTimeoutSource,
      executionTimeoutMs: parsed.data.PASEO_EXECUTION_TIMEOUT_MS,
      executionTimeoutSource,
      sessionRpcTimeoutMs: parsed.data.PASEO_SESSION_RPC_TIMEOUT_MS,
      sessionRpcTimeoutSource,
    },
  });
}

function requiredConfig(value: string | undefined): string {
  if (!value) throw new Error('validated configuration value is missing');
  return value;
}
