import { Client, AppType, Domain } from '@larksuiteoapi/node-sdk';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type {
  BotDocument,
  MemoryDocumentDraft,
  MemoryDocumentPort,
} from '../../application/ports/lark-memory-document.js';

export type DocumentClient = {
  docx: {
    document: { create: (input: any) => Promise<any> };
    documentBlockChildren: {
      create: (input: any) => Promise<any>;
      get: (input: any) => Promise<any>;
    };
  };
  drive: { permissionMember: { create: (input: any) => Promise<any> } };
  request?: (input: any) => Promise<any>;
};

export type DocumentBuilder = (
  category: string,
  proposal: string,
) => readonly Record<string, unknown>[];
export type DocumentParser = (blocks: readonly unknown[]) => string;

const MAX_BLOCKS = 200;
const MAX_PREVIEW_BYTES = 4096;

export function buildMemoryDocumentBlocks(
  category: string,
  proposal: string,
): readonly Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [textBlock(proposal)];
  if (blocks.length > MAX_BLOCKS)
    throw new Error('memory document exceeds block limit');
  return blocks;
}

export function parseDocumentBody(blocks: readonly unknown[]): string {
  if (blocks.length > MAX_BLOCKS)
    throw new Error('memory document has too many blocks');
  const content = blocks.map(blockText).filter(Boolean).join('\n').trim();
  if (!content || Buffer.byteLength(content, 'utf8') > 32768)
    throw new Error('document body is empty or exceeds 32768 UTF-8 bytes');
  return content;
}

export function createLarkMemoryDocumentAdapter(
  config: LarkCanaryEnabledConfig,
  injected?: {
    client?: DocumentClient;
    builder?: DocumentBuilder;
    parser?: DocumentParser;
  },
): MemoryDocumentPort {
  const client =
    injected?.client ??
    (new Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: AppType.SelfBuild,
      domain: config.domain === 'feishu' ? Domain.Feishu : Domain.Lark,
    }) as unknown as DocumentClient);
  const builder = injected?.builder ?? buildMemoryDocumentBlocks;
  const parser = injected?.parser ?? parseDocumentBody;
  const base = (
    config.docWebBaseUrl ?? process.env.LARK_CANARY_DOC_WEB_BASE_URL
  )?.replace(/\/$/, '');
  return {
    async create(input) {
      if (!base) throw new Error('document web base URL is not configured');
      const created = await client.docx.document.create({
        data: { title: `Workspace memory: ${input.category}` },
      });
      const document = created?.data?.document;
      const token = document?.document_id;
      if (!token) throw new Error('document provider create failed');
      const blocks = builder(input.category, input.proposal);
      for (let i = 0; i < blocks.length; i += 50) {
        const children = blocks.slice(i, i + 50);
        await client.docx.documentBlockChildren.create({
          path: { document_id: token, block_id: token },
          data: { index: i, children },
        });
      }
      await client.drive.permissionMember.create({
        path: { token },
        params: { type: 'docx' },
        data: {
          member_type: 'openid',
          member_id: input.allowedOpenId,
          perm: 'edit',
          type: 'user',
        },
      });
      return {
        token,
        revision: String(document.revision_id ?? 0),
        url: `${base}/docx/${token}`,
      };
    },
    async readDraft(token): Promise<MemoryDocumentDraft> {
      const blocks = await readAllBlocks(client, token);
      if (!client.request)
        throw new Error('document comment retrieval is unavailable');
      const comments = await readUnresolvedComments(client, token);
      return {
        body: parser(blocks.items),
        revision: blocks.revision,
        unresolvedComments: comments,
      };
    },
  };
}

async function readAllBlocks(
  client: DocumentClient,
  token: string,
): Promise<{ items: readonly unknown[]; revision: string }> {
  const items: unknown[] = [];
  let pageToken: string | undefined;
  let revision = '0';
  for (;;) {
    const response = await client.docx.documentBlockChildren.get({
      path: { document_id: token, block_id: token },
      params: {
        page_size: 200,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    const data = response?.data;
    if (!data || !Array.isArray(data.items))
      throw new Error('document body page is incomplete');
    items.push(...data.items);
    if (items.length > MAX_BLOCKS)
      throw new Error('memory document has too many blocks');
    revision = String(data.document_revision_id ?? revision);
    if (!data.has_more) return { items, revision };
    if (typeof data.page_token !== 'string' || !data.page_token)
      throw new Error('document body pagination is incomplete');
    pageToken = data.page_token;
  }
}

async function readUnresolvedComments(
  client: DocumentClient,
  token: string,
): Promise<
  readonly { id: string; text: string; replies: readonly string[] }[]
> {
  const comments: { id: string; text: string; replies: readonly string[] }[] =
    [];
  let totalReplies = 0;
  let pageToken: string | undefined;
  for (;;) {
    const response = await client.request!({
      method: 'GET',
      url: `/open-apis/drive/v1/files/${token}/comments`,
      params: {
        file_type: 'docx',
        is_solved: false,
        page_size: 100,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    const data = response?.data;
    if (!data || !Array.isArray(data.items))
      throw new Error('document comments page is incomplete');
    for (const item of data.items) {
      if (!isRecord(item) || typeof item.comment_id !== 'string')
        throw new Error('document comment is malformed');
      if (item.is_solved === true) continue;
      const thread = await readReplies(client, token, item.comment_id);
      const text = thread[0];
      if (!text) throw new Error('document comment is malformed');
      const replies = thread.slice(1);
      totalReplies += thread.length;
      if (totalReplies > 200) throw new Error('document replies exceed bounds');
      comments.push({
        id: item.comment_id,
        text,
        replies,
      });
      if (comments.length > 100)
        throw new Error('too many unresolved document comments');
    }
    if (!data.has_more) return comments;
    if (typeof data.page_token !== 'string' || !data.page_token)
      throw new Error('document comments pagination is incomplete');
    pageToken = data.page_token;
  }
}

async function readReplies(
  client: DocumentClient,
  token: string,
  commentId: string,
): Promise<readonly string[]> {
  const replies: string[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const response = await client.request!({
      method: 'GET',
      url: `/open-apis/drive/v1/files/${token}/comments/${commentId}/replies`,
      params: {
        file_type: 'docx',
        page_size: 100,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    const data = response?.data;
    if (!data || !Array.isArray(data.items))
      throw new Error('document replies page is incomplete');
    replies.push(...data.items.map((item: unknown) => extractText(item)));
    if (
      replies.length > 200 ||
      Buffer.byteLength(replies.join('\n'), 'utf8') > 32768
    )
      throw new Error('document replies exceed bounds');
    if (!data.has_more) return replies;
    if (typeof data.page_token !== 'string' || !data.page_token)
      throw new Error('document replies pagination is incomplete');
    pageToken = data.page_token;
  }
}

function textBlock(content: string): Record<string, unknown> {
  return { block_type: 2, text: { elements: [{ text_run: { content } }] } };
}
function blockText(value: unknown): string {
  if (!isRecord(value)) return '';
  if (isRecord(value.text)) return elementsText(value.text.elements);
  return '';
}
function elementsText(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!isRecord(item) || !isRecord(item.text_run)) return '';
          if (typeof item.text_run.content === 'string')
            return item.text_run.content;
          return typeof item.text_run.text === 'string'
            ? item.text_run.text
            : '';
        })
        .join('')
    : '';
}
function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  if (typeof value.content === 'string') return value.content;
  if (isRecord(value.content)) return extractText(value.content);
  if (typeof value.text === 'string') return value.text;
  if (Array.isArray(value.elements)) return elementsText(value.elements);
  return '';
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
