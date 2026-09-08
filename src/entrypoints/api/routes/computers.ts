import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';

import type { ComputerRepository } from '../../../application/ports/computer-repository.js';
import type { Computer } from '../../../domain/runtime/computer.js';
import {
  ComputerResponseSchema,
  CreateComputerRequestSchema,
  ListComputersResponseSchema,
  MAX_COMPUTER_REQUEST_BYTES,
} from '../../../contracts/computers.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import { readBoundedJson } from '../read-bounded-json.js';

/**
 * The Computer layer's only reachable surface today: create one under the
 * caller's tenant/workspace and list them back. Pairing, credentials, and
 * status transitions are explicitly out of scope for this slice.
 */
export function registerComputerRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly computerRepository: ComputerRepository;
    readonly now?: () => Date;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/computers', auth);
  const now = dependencies.now ?? (() => new Date());

  app.post('/api/v1/computers', async (c) => {
    const parsed = CreateComputerRequestSchema.safeParse(await body(c.req.raw));
    if (!parsed.success) throw invalidRequest();
    const owner = getAuthenticatedAccessContext(c);
    const at = now().toISOString();
    const computer: Computer = Object.freeze({
      id: randomUUID(),
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      status: 'offline',
      createdAt: at,
      updatedAt: at,
    });
    const created = await dependencies.computerRepository.create(computer);
    return c.json(ComputerResponseSchema.parse(toResponse(created)), 201);
  });

  app.get('/api/v1/computers', async (c) => {
    const owner = getAuthenticatedAccessContext(c);
    const items = await dependencies.computerRepository.listByWorkspace({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
    });
    return c.json(
      ListComputersResponseSchema.parse({
        items: items.map(toResponse),
      }),
      200,
    );
  });
}

async function body(request: Request): Promise<unknown> {
  try {
    return await readBoundedJson(request, MAX_COMPUTER_REQUEST_BYTES);
  } catch {
    throw invalidRequest();
  }
}

function invalidRequest(): HttpError {
  return new HttpError(400, 'invalid_request', 'The request body is invalid.');
}

function toResponse(computer: Computer) {
  return {
    id: computer.id,
    kind: computer.kind,
    name: computer.name,
    status: computer.status,
    created_at: computer.createdAt,
    updated_at: computer.updatedAt,
  };
}
