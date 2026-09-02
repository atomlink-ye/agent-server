import type { Hono } from 'hono';

import type { WorkOrganizationService } from '../../../application/work-organization/work-organization-service.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { WorkDefinitionValidationError } from '../../../application/work/work-identity-api.js';
import {
  WorkIdentityConflictError,
  WorkNotFoundError,
  WorkWorkspaceScopeUnavailableError,
} from '../../../domain/work/work.js';
import {
  WorkBoardColumnNotFoundError,
  WorkBoardNotFoundError,
  WorkItemClaimConflictError,
  WorkItemNotFoundError,
  WorkOrganizationValidationError,
} from '../../../domain/work-organization/work-organization.js';
import {
  ClaimWorkItemRequestSchema,
  ClaimWorkItemResponseSchema,
  CreateWorkBoardColumnRequestSchema,
  CreateWorkBoardRequestSchema,
  CreateWorkItemCommentRequestSchema,
  CreateWorkItemRequestSchema,
  PlaceWorkItemRequestSchema,
  PromoteWorkItemRequestSchema,
  UpdateWorkBoardColumnRequestSchema,
  UpdateWorkBoardRequestSchema,
  UpdateWorkItemRequestSchema,
  WorkBoardListResponseSchema,
  WorkBoardSnapshotSchema,
  WorkItemCommentsResponseSchema,
  WorkItemDetailSchema,
  WorkItemListResponseSchema,
  toClaimWorkItemResponse,
  toWorkBoardColumnResponse,
  toWorkBoardPlacementResponse,
  toWorkBoardResponse,
  toWorkItemCommentResponse,
  toWorkItemDetailResponse,
  toWorkItemResponse,
} from '../../../contracts/work-organization.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import { getRequestAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import { readBoundedJson } from '../read-bounded-json.js';

export interface WorkOrganizationRouteDependencies {
  readonly config: AppConfig;
  readonly service: WorkOrganizationService;
}

export function registerWorkOrganizationRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: WorkOrganizationRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  for (const prefix of ['/api/v1/work-items', '/api/v1/boards']) {
    app.use(prefix, requireServiceAccountAccess(authenticator));
    app.use(`${prefix}/*`, requireServiceAccountAccess(authenticator));
  }

  app.get('/api/v1/work-items', async (context) => {
    const access = getRequestAccessContext(context);
    try {
      const items = await dependencies.service.listWorkItems(access);
      return context.json(
        WorkItemListResponseSchema.parse({
          work_items: items.map(toWorkItemDetailResponse),
        }),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/work-items', async (context) => {
    const parsed = CreateWorkItemRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 96 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid WorkItem request is required.');
    const access = getRequestAccessContext(context);
    try {
      const detail = await dependencies.service.createWorkItem({
        accessContext: access,
        title: parsed.data.title,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.assignee_id !== undefined
          ? { assigneeId: parsed.data.assignee_id }
          : {}),
        ...(parsed.data.source_conversation_id !== undefined
          ? { sourceConversationId: parsed.data.source_conversation_id }
          : {}),
        ...(parsed.data.source_message_id !== undefined
          ? { sourceMessageId: parsed.data.source_message_id }
          : {}),
        ...(parsed.data.board_id !== undefined
          ? { boardId: parsed.data.board_id }
          : {}),
        ...(parsed.data.column_id !== undefined
          ? { columnId: parsed.data.column_id }
          : {}),
        ...(parsed.data.position !== undefined
          ? { position: parsed.data.position }
          : {}),
      });
      return context.json(
        WorkItemDetailSchema.parse(toWorkItemDetailResponse(detail)),
        201,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.get('/api/v1/work-items/:workItemId', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    try {
      const detail = await dependencies.service.getWorkItem(
        getRequestAccessContext(context),
        workItemId,
      );
      return context.json(
        WorkItemDetailSchema.parse(toWorkItemDetailResponse(detail)),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.patch('/api/v1/work-items/:workItemId', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    const parsed = UpdateWorkItemRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 96 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid WorkItem update is required.');
    try {
      const detail = await dependencies.service.updateWorkItem({
        accessContext: getRequestAccessContext(context),
        workItemId,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.status !== undefined
          ? { status: parsed.data.status }
          : {}),
        ...(parsed.data.assignee_id !== undefined
          ? { assigneeId: parsed.data.assignee_id }
          : {}),
      });
      return context.json(
        WorkItemDetailSchema.parse(toWorkItemDetailResponse(detail)),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/work-items/:workItemId/claim', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    // The body carries nothing today, but it is parsed so an unknown field is
    // rejected now rather than silently ignored until the shape grows.
    const parsed = ClaimWorkItemRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 4 * 1024).catch(() => ({})),
    );
    if (!parsed.success) throw invalidRequest('认领请求不接受任何字段。');
    try {
      const claim = await dependencies.service.claimWorkItem({
        accessContext: getRequestAccessContext(context),
        workItemId,
      });
      return context.json(
        ClaimWorkItemResponseSchema.parse(toClaimWorkItemResponse(claim)),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/work-items/:workItemId/promote', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    const parsed = PromoteWorkItemRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid Work promotion request is required.');
    try {
      const detail = await dependencies.service.promoteWorkItem({
        accessContext: getRequestAccessContext(context),
        workItemId,
        definitionId: parsed.data.definition_id,
        definitionVersionId: parsed.data.definition_version_id,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title }
          : {}),
      });
      return context.json(
        WorkItemDetailSchema.parse(toWorkItemDetailResponse(detail)),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.get('/api/v1/work-items/:workItemId/comments', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    try {
      const comments = await dependencies.service.listComments(
        getRequestAccessContext(context),
        workItemId,
      );
      return context.json(
        WorkItemCommentsResponseSchema.parse({
          comments: comments.map(toWorkItemCommentResponse),
        }),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/work-items/:workItemId/comments', async (context) => {
    const workItemId = requireUuid(
      context.req.param('workItemId'),
      'workItemId',
    );
    const parsed = CreateWorkItemCommentRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid WorkItem comment is required.');
    try {
      const comment = await dependencies.service.addComment({
        accessContext: getRequestAccessContext(context),
        workItemId,
        body: parsed.data.body,
      });
      return context.json({ comment: toWorkItemCommentResponse(comment) }, 201);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.get('/api/v1/boards', async (context) => {
    try {
      const boards = await dependencies.service.listBoards(
        getRequestAccessContext(context),
      );
      return context.json(
        WorkBoardListResponseSchema.parse({
          boards: boards.map(toWorkBoardResponse),
        }),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/boards', async (context) => {
    const parsed = CreateWorkBoardRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid Board request is required.');
    try {
      const board = await dependencies.service.createBoard({
        accessContext: getRequestAccessContext(context),
        title: parsed.data.title,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      });
      return context.json({ board: toWorkBoardResponse(board) }, 201);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.get('/api/v1/boards/:boardId', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    try {
      const snapshot = await dependencies.service.getBoard(
        getRequestAccessContext(context),
        boardId,
      );
      return context.json(
        WorkBoardSnapshotSchema.parse({
          board: toWorkBoardResponse(snapshot.board),
          columns: snapshot.columns.map(toWorkBoardColumnResponse),
          placements: snapshot.placements.map(toWorkBoardPlacementResponse),
          work_items: snapshot.workItems.map(toWorkItemResponse),
        }),
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.patch('/api/v1/boards/:boardId', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    const parsed = UpdateWorkBoardRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid Board update is required.');
    try {
      const board = await dependencies.service.updateBoard({
        accessContext: getRequestAccessContext(context),
        boardId,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      });
      return context.json({ board: toWorkBoardResponse(board) }, 200);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.delete('/api/v1/boards/:boardId', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    try {
      await dependencies.service.deleteBoard(
        getRequestAccessContext(context),
        boardId,
      );
      return context.body(null, 204);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.post('/api/v1/boards/:boardId/columns', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    const parsed = CreateWorkBoardColumnRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid Board column is required.');
    try {
      const column = await dependencies.service.createColumn({
        accessContext: getRequestAccessContext(context),
        boardId,
        title: parsed.data.title,
        ...(parsed.data.position !== undefined
          ? { position: parsed.data.position }
          : {}),
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      });
      return context.json({ column: toWorkBoardColumnResponse(column) }, 201);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.patch('/api/v1/boards/:boardId/columns/:columnId', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    const columnId = requireUuid(context.req.param('columnId'), 'columnId');
    const parsed = UpdateWorkBoardColumnRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid Board column update is required.');
    try {
      const column = await dependencies.service.updateColumn({
        accessContext: getRequestAccessContext(context),
        boardId,
        columnId,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title }
          : {}),
        ...(parsed.data.position !== undefined
          ? { position: parsed.data.position }
          : {}),
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      });
      return context.json({ column: toWorkBoardColumnResponse(column) }, 200);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.delete('/api/v1/boards/:boardId/columns/:columnId', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    const columnId = requireUuid(context.req.param('columnId'), 'columnId');
    try {
      await dependencies.service.deleteColumn({
        accessContext: getRequestAccessContext(context),
        boardId,
        columnId,
      });
      return context.body(null, 204);
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });

  app.put('/api/v1/boards/:boardId/placement', async (context) => {
    const boardId = requireUuid(context.req.param('boardId'), 'boardId');
    const parsed = PlaceWorkItemRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 32 * 1024),
    );
    if (!parsed.success)
      throw invalidRequest('A valid WorkItem placement is required.');
    try {
      const placement = await dependencies.service.placeWorkItem({
        accessContext: getRequestAccessContext(context),
        boardId,
        columnId: parsed.data.column_id,
        workItemId: parsed.data.work_item_id,
        ...(parsed.data.position !== undefined
          ? { position: parsed.data.position }
          : {}),
      });
      return context.json(
        { placement: toWorkBoardPlacementResponse(placement) },
        200,
      );
    } catch (error) {
      throw mapWorkOrganizationError(error);
    }
  });
}

function invalidRequest(message: string): HttpError {
  return new HttpError(400, 'invalid_request', message);
}

function requireUuid(value: string, field: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw invalidRequest(`${field} must be a UUID.`);
  return value;
}

function mapWorkOrganizationError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  if (error instanceof WorkItemNotFoundError)
    return new HttpError(404, error.code, error.message);
  if (error instanceof WorkBoardNotFoundError)
    return new HttpError(404, error.code, error.message);
  if (error instanceof WorkBoardColumnNotFoundError)
    return new HttpError(404, error.code, error.message);
  if (error instanceof WorkItemClaimConflictError)
    return new HttpError(409, error.code, error.message);
  if (error instanceof WorkOrganizationValidationError)
    return new HttpError(400, error.code, error.message);
  if (error instanceof WorkDefinitionValidationError)
    return new HttpError(400, error.code, error.message);
  if (error instanceof WorkNotFoundError)
    return new HttpError(404, 'work_not_found', error.message);
  if (error instanceof WorkIdentityConflictError)
    return new HttpError(409, 'work_identity_conflict', error.message);
  if (error instanceof WorkWorkspaceScopeUnavailableError)
    return new HttpError(409, 'workspace_scope_unavailable', error.message);
  return error instanceof Error
    ? error
    : new Error('Unknown work organization failure.');
}
