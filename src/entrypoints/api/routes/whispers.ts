import type { Hono } from 'hono';

import type { WhisperChannel } from '../../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../../domain/whisper/whisper-message.js';
import type { WhisperRepository } from '../../../application/ports/whisper-repository.js';
import { PeekWhisperChannels } from '../../../application/whisper/peek-whisper-channels.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { HttpError } from '../../../contracts/http.js';

const BASE = '/api/v1/whispers';

export interface WhisperRouteDependencies {
  readonly config: AppConfig;
  readonly whispers: WhisperRepository;
}

/**
 * Human-facing "peek" surface only: every route here is a GET. Agents never
 * reach whisper channels through this plane -- they use the whisper_open /
 * whisper_send runtime MCP tools instead, so there is no write route for a
 * human to accidentally be given access to.
 */
export function registerWhisperRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: WhisperRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  const auth = requireServiceAccountAccess(authenticator);
  const peek = new PeekWhisperChannels(dependencies.whispers);
  app.use(BASE, auth);
  app.use(`${BASE}/*`, auth);

  app.get(BASE, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const whispers = await peek.listChannels(access.tenantId);
    return c.json({ whispers: whispers.map(whisperResponse) });
  });

  app.get(`${BASE}/:whisperChannelId`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const found = await peek.getChannelWithMessages(
      access.tenantId,
      c.req.param('whisperChannelId'),
    );
    if (!found) throw notFound();
    return c.json({ whisper: whisperResponse(found.channel) });
  });

  app.get(`${BASE}/:whisperChannelId/messages`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const found = await peek.getChannelWithMessages(
      access.tenantId,
      c.req.param('whisperChannelId'),
    );
    if (!found) throw notFound();
    return c.json({ messages: found.messages.map(whisperMessageResponse) });
  });
}

function notFound(): HttpError {
  return new HttpError(
    404,
    'whisper_not_found',
    'The requested whisper channel does not exist.',
  );
}

function whisperResponse(channel: WhisperChannel) {
  return {
    whisper_channel_id: channel.id,
    topic: channel.topic,
    members: channel.memberAgentDefinitionIds,
    initiated_by: channel.initiatedByAgentDefinitionId,
    origin: {
      conversation_id: channel.origin.conversationId,
      trigger_message_id: channel.origin.triggerMessageId,
      work_ref: channel.origin.workRef,
    },
    created_at: channel.createdAt,
    updated_at: channel.updatedAt,
  };
}

function whisperMessageResponse(message: WhisperMessage) {
  return {
    message_id: message.id,
    whisper_channel_id: message.whisperChannelId,
    sequence: message.sequence,
    author_agent_id: message.authorAgentDefinitionId,
    body: message.body,
    created_at: message.createdAt,
  };
}
