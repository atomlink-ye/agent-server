import 'server-only';

import { AgentServerError, getChatWorkCard } from '@/lib/agent-server-client';

export type PublicChatWorkCard = {
  workId: string;
  workRef: string;
  title: string;
  productState: 'running' | 'needs_you' | 'complete' | 'problem' | 'not_captured';
  problemKind: 'failed' | 'cancelled' | 'not_captured' | null;
  attentionReason: 'completion_approval_pending' | 'not_captured' | null;
  resultSummary: string | null;
  resultCaptureStatus: 'present' | 'not_present' | 'redacted' | 'not_captured';
};

export class WorkChatCardBffError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'WorkChatCardBffError';
    this.status = status;
    this.code = code;
  }
}

export async function readWorkChatCardBff(workId: string): Promise<PublicChatWorkCard> {
  if (!isUuid(workId)) throw new WorkChatCardBffError(400, 'invalid_request');

  try {
    return sanitizeChatWorkCard(await getChatWorkCard(workId));
  } catch (error) {
    throw sanitizeError(error);
  }
}

export function workChatCardErrorResponse(error: unknown) {
  const bffError =
    error instanceof WorkChatCardBffError
      ? error
      : new WorkChatCardBffError(502, 'work_chat_card_unavailable');
  const messages: Record<string, string> = {
    invalid_request: 'The Work identifier is invalid.',
    work_not_found: 'The requested Work was not found.',
    work_chat_card_unavailable: 'Work Chat cards are unavailable.',
  };
  return {
    status: bffError.status,
    body: {
      error: {
        code: bffError.code,
        message: messages[bffError.code] ?? 'Work Chat cards are unavailable.',
      },
    },
  };
}

function sanitizeError(error: unknown): WorkChatCardBffError {
  if (error instanceof WorkChatCardBffError) return error;
  if (error instanceof AgentServerError) {
    if (error.status === 404) return new WorkChatCardBffError(404, 'work_not_found');
    if (error.status === 503) return new WorkChatCardBffError(503, 'work_chat_card_unavailable');
  }
  return new WorkChatCardBffError(502, 'work_chat_card_unavailable');
}

function sanitizeChatWorkCard(value: unknown): PublicChatWorkCard {
  const card = asRecord(value);
  if (
    !isNonEmptyString(card.workId) ||
    !isNonEmptyString(card.workRef) ||
    !isNonEmptyString(card.title) ||
    !isProductState(card.productState) ||
    !isProblemKind(card.problemKind) ||
    !isAttentionReason(card.attentionReason) ||
    !nullableString(card.resultSummary) ||
    !isResultCaptureStatus(card.resultCaptureStatus)
  )
    throw new WorkChatCardBffError(502, 'work_chat_card_unavailable');

  return {
    workId: card.workId,
    workRef: card.workRef,
    title: card.title,
    productState: card.productState,
    problemKind: card.problemKind,
    attentionReason: card.attentionReason,
    resultSummary: card.resultSummary,
    resultCaptureStatus: card.resultCaptureStatus,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkChatCardBffError(502, 'work_chat_card_unavailable');
  return value as Record<string, unknown>;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isProductState(value: unknown): value is PublicChatWorkCard['productState'] {
  return (
    value === 'running' ||
    value === 'needs_you' ||
    value === 'complete' ||
    value === 'problem' ||
    value === 'not_captured'
  );
}

function isProblemKind(value: unknown): value is PublicChatWorkCard['problemKind'] {
  return value === null || value === 'failed' || value === 'cancelled' || value === 'not_captured';
}

function isAttentionReason(value: unknown): value is PublicChatWorkCard['attentionReason'] {
  return value === null || value === 'completion_approval_pending' || value === 'not_captured';
}

function isResultCaptureStatus(value: unknown): value is PublicChatWorkCard['resultCaptureStatus'] {
  return (
    value === 'present' ||
    value === 'not_present' ||
    value === 'redacted' ||
    value === 'not_captured'
  );
}
