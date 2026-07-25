import { describe, expect, it } from 'vitest';
import {
  buildMemoryDocumentBlocks,
  createLarkMemoryDocumentAdapter,
  parseDocumentBody,
} from './lark-memory-document.js';

const config = {
  enabled: true as const,
  appId: 'a',
  appSecret: 's',
  domain: 'lark' as const,
  connectionKey: 'c',
  botOpenId: 'b',
  allowedChatId: 'h',
  allowedOpenId: 'u',
  tenantId: 't',
  workspaceId: 'w',
  serviceAccountId: 'sa',
  publishedAgentVersionId: 'v',
  policyVersion: 'p',
  docWebBaseUrl: 'https://lark.test',
};

describe('lark collaborative memory documents', () => {
  it('creates only the proposal as an editable body', () => {
    const blocks = buildMemoryDocumentBlocks(
      'Decision',
      'Keep weekly summaries.',
    );
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).not.toContain('Final Accepted Content');
    expect(parseDocumentBody(blocks)).toBe('Keep weekly summaries.');
  });

  it('reads paginated body and unresolved comments/replies while excluding resolved comments', async () => {
    const requests: any[] = [];
    const client = {
      docx: {
        document: {
          create: async () => ({
            data: { document: { document_id: 'doc-1', revision_id: 7 } },
          }),
        },
        documentBlockChildren: {
          create: async () => ({}),
          get: async (input: any) =>
            input.params.page_token
              ? {
                  data: {
                    items: [
                      {
                        block_type: 2,
                        text: {
                          elements: [{ text_run: { content: ' body' } }],
                        },
                      },
                    ],
                    document_revision_id: 8,
                    has_more: false,
                  },
                }
              : {
                  data: {
                    items: [
                      {
                        block_type: 2,
                        text: { elements: [{ text_run: { content: 'body' } }] },
                      },
                    ],
                    document_revision_id: 7,
                    has_more: true,
                    page_token: 'next',
                  },
                },
        },
      },
      drive: { permissionMember: { create: async () => ({}) } },
      request: async (input: any) => {
        requests.push(input);
        if (input.url.endsWith('/comments'))
          return {
            data: {
              items: [
                {
                  comment_id: 'c1',
                  is_solved: false,
                  reply_list: {
                    replies: [
                      {
                        content: {
                          elements: [{ text_run: { text: 'Apply UTC' } }],
                        },
                      },
                    ],
                  },
                },
                { comment_id: 'resolved', is_solved: true },
              ],
              has_more: false,
            },
          };
        return {
          data: {
            items: [
              {
                content: {
                  elements: [{ text_run: { text: 'Apply UTC' } }],
                },
              },
              {
                content: {
                  elements: [{ text_run: { text: 'Reply' } }],
                },
              },
            ],
            has_more: false,
          },
        };
      },
    } as any;
    const draft = await createLarkMemoryDocumentAdapter(config, {
      client,
    }).readDraft('doc-1');
    expect(draft.body).toBe('body\n body');
    expect(draft.revision).toBe('8');
    expect(draft.unresolvedComments).toEqual([
      { id: 'c1', text: 'Apply UTC', replies: ['Reply'] },
    ]);
    expect(requests).toHaveLength(2);
  });

  it('fails closed on incomplete pagination and bounds', async () => {
    const client = {
      docx: {
        document: { create: async () => ({}) },
        documentBlockChildren: {
          create: async () => ({}),
          get: async () => ({ data: { items: [], has_more: true } }),
        },
      },
      drive: { permissionMember: { create: async () => ({}) } },
    } as any;
    await expect(
      createLarkMemoryDocumentAdapter(config, { client }).readDraft('doc-1'),
    ).rejects.toThrow(/pagination/);
    expect(() =>
      parseDocumentBody([
        {
          block_type: 2,
          text: { elements: [{ text_run: { content: 'x'.repeat(32769) } }] },
        },
      ]),
    ).toThrow();
  });

  it('rejects an unresolved comment whose fetched thread has no root text', async () => {
    const client = {
      docx: {
        document: { create: async () => ({}) },
        documentBlockChildren: {
          create: async () => ({}),
          get: async () => ({ data: { items: [] } }),
        },
      },
      drive: { permissionMember: { create: async () => ({}) } },
      request: async (input: any) =>
        input.url.endsWith('/comments')
          ? {
              data: {
                items: [{ comment_id: 'empty', is_solved: false }],
                has_more: false,
              },
            }
          : { data: { items: [], has_more: false } },
    } as any;
    await expect(
      createLarkMemoryDocumentAdapter(config, { client }).readDraft('doc-1'),
    ).rejects.toThrow(/comment is malformed/);
  });

  it('fails closed when comment retrieval is unavailable or any continuation fails', async () => {
    const body = {
      docx: {
        document: { create: async () => ({}) },
        documentBlockChildren: {
          create: async () => ({}),
          get: async () => ({
            data: {
              items: [
                {
                  block_type: 2,
                  text: { elements: [{ text_run: { content: 'body' } }] },
                },
              ],
            },
          }),
        },
      },
      drive: { permissionMember: { create: async () => ({}) } },
    } as any;
    await expect(
      createLarkMemoryDocumentAdapter(config, { client: body }).readDraft(
        'doc-1',
      ),
    ).rejects.toThrow(/comment retrieval/);
    const broken = {
      ...body,
      request: async (input: any) =>
        input.url.endsWith('/comments') && !input.params.page_token
          ? {
              data: {
                items: [{ comment_id: 'c1', content: 'change' }],
                has_more: true,
                page_token: 'next',
              },
            }
          : { data: {} },
    } as any;
    await expect(
      createLarkMemoryDocumentAdapter(config, { client: broken }).readDraft(
        'doc-1',
      ),
    ).rejects.toThrow(/page is incomplete/);
  });

  it('enforces the reply bound across all unresolved comments', async () => {
    const client = {
      docx: {
        document: { create: async () => ({}) },
        documentBlockChildren: {
          create: async () => ({}),
          get: async () => ({
            data: {
              items: [
                {
                  block_type: 2,
                  text: { elements: [{ text_run: { content: 'body' } }] },
                },
              ],
            },
          }),
        },
      },
      drive: { permissionMember: { create: async () => ({}) } },
      request: async (input: any) => {
        if (input.url.endsWith('/comments'))
          return {
            data: {
              items: [
                { comment_id: 'c1', content: 'one' },
                { comment_id: 'c2', content: 'two' },
              ],
              has_more: false,
            },
          };
        return {
          data: {
            items: Array.from(
              { length: input.url.endsWith('/c1/replies') ? 100 : 101 },
              (_, index) => ({ content: `reply-${index}` }),
            ),
            has_more: false,
          },
        };
      },
    } as any;
    await expect(
      createLarkMemoryDocumentAdapter(config, { client }).readDraft('doc-1'),
    ).rejects.toThrow(/replies exceed bounds/);
  });

  it('preserves create/write/grant SDK behavior', async () => {
    const calls: string[] = [];
    const client = {
      docx: {
        document: {
          create: async () => ({
            data: { document: { document_id: 'doc-1', revision_id: 7 } },
          }),
        },
        documentBlockChildren: {
          create: async (x: any) => {
            calls.push(JSON.stringify(x));
            return {};
          },
          get: async () => ({ data: { items: [] } }),
        },
      },
      drive: {
        permissionMember: {
          create: async (x: any) => {
            calls.push(JSON.stringify(x));
            return {};
          },
        },
      },
    } as any;
    const doc = await createLarkMemoryDocumentAdapter(config, {
      client,
    }).create({
      category: 'Decision',
      proposal: 'Keep it',
      allowedOpenId: 'ou-user',
    });
    expect(doc).toEqual({
      token: 'doc-1',
      revision: '7',
      url: 'https://lark.test/docx/doc-1',
    });
    expect(calls.some((call) => call.includes('"block_id":"doc-1"'))).toBe(
      true,
    );
    expect(
      calls.some(
        (call) =>
          call.includes('"member_type":"openid"') &&
          call.includes('"member_id":"ou-user"') &&
          call.includes('"perm":"edit"'),
      ),
    ).toBe(true);
    const grant = calls.find((call) => call.includes('member_type'));
    expect(grant).not.toContain('perm_type');
  });
});
