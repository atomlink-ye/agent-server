import { stringify } from 'yaml';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AppProviders } from '../providers';
import { AppRouter } from './index';
import { setLocale } from '../../i18n';
import type { ChatCommands } from '../../features/conversations/contracts';
import {
  ProductRunTraceSuccessSchema,
  ProductWorkDefinitionVersionSchema,
  ProductSessionTranscriptsResponseSchema,
  WorkChatMessagesResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';
import recording from '../../test-support/fixtures/product-recordings/rework-once.json';
import {
  projectWorkList,
  projectWorkRunList,
} from '../../test-support/product-recording-test-helpers';
import '../../index.css';
import {
  expectNoVerticalTraps,
  expectScrollReachable,
} from '../../test-support/scroll-assertions';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const recordedTrace = ProductRunTraceSuccessSchema.parse(
  recording.recording_documents[0],
);
const workId = recordedTrace.work.id;
const recordedWork = projectWorkList(recording).works[0]!;
const recordedRun = projectWorkRunList(recording, workId).work_runs[0]!;
const runId = recordedTrace.work_run.id;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const taskId = uuid(700);
const date = '2026-08-21T00:00:00.000Z';
const lines = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Checkpoint ${i + 1}: review the evidence.`,
  ).join('\n\n');

type Size = 'realistic' | 'oversized';
function fixtures(size: Size, locale: 'en' | 'zh-CN', preparation: boolean) {
  const large = size === 'oversized';
  const count = large ? 50 : 3;
  const title = large
    ? (locale === 'en' ? 'Research' : '研究').repeat(100).slice(0, 200)
    : 'Supplier research';
  const prose = lines(large ? 2000 : 8);
  const paragraphs = prose.split('\n\n');
  const chunks = Array.from(
    { length: Math.ceil(paragraphs.length / 10) },
    (_, i) => paragraphs.slice(i * 10, i * 10 + 10).join('\n\n'),
  );
  const work = { ...recordedTrace.work, title };
  const works = Array.from({ length: count }, (_, i) => ({
    ...recordedWork,
    id: i === 0 ? workId : uuid(100 + i),
    title: `${i} ${title}`.slice(0, 200),
  }));
  const runs = Array.from({ length: preparation ? 0 : count }, (_, i) => ({
    ...recordedRun,
    id: i === 0 ? runId : uuid(200 + i),
  }));
  const coworkers = Array.from({ length: count }, (_, i) => ({
    id: uuid(300 + i),
    display_name: `${i} ${title}`.slice(0, 200),
    role_label: 'Researcher',
    summary: 'Review supplier reports',
    active_agent_version_id: uuid(400 + i),
    runtime_status: 'available',
  }));
  const conversations = coworkers.map((agent, i) => ({
    id: uuid(500 + i),
    kind: 'direct' as const,
    title: agent.display_name,
    directAgent: {
      agentDefinitionId: agent.id,
      displayName: agent.display_name,
    },
    updatedAt: date,
  }));
  const commands: ChatCommands = {
    loadCoworkers: async () =>
      coworkers.map((c) => ({
        id: c.id,
        displayName: c.display_name,
        roleLabel: c.role_label,
        summary: c.summary,
        activeAgentVersionId: c.active_agent_version_id,
        runtimeStatus: 'available' as const,
      })),
    loadConversations: async () => conversations,
    createConversation: async () => {
      throw new Error('Unexpected mutation');
    },
    loadMessages: async (id) => [
      {
        id: uuid(600),
        conversationId: id,
        sequence: 1,
        authorType: 'agent_definition',
        authorId: coworkers[0]!.id,
        body: prose,
        workRef: null,
        createdAt: date,
      },
    ],
    sendMessage: async () => {
      throw new Error('Unexpected mutation');
    },
  };
  const entries = Array.from({ length: count }, (_, i) => ({
    id: uuid(800 + i),
    path: `notes/${title}-${i}.md`,
    current_version: 1,
    content_sha256: 'a'.repeat(64),
    created_at: date,
    updated_at: date,
  }));
  const tasks = Array.from({ length: count }, (_, i) => ({
    work_item: {
      id: uuid(700 + i),
      workspace_id: uuid(900),
      title: `${i} ${title}`.slice(0, 200),
      description: prose,
      status: 'todo',
      assignee_id: null,
      mentions: [],
      created_by: 'principal-1',
      source_conversation_id: null,
      source_message_id: null,
      linked_work_id: null,
      created_at: date,
      updated_at: date,
    },
    linked_work: null,
  }));
  const definition = {
    id: work.definition_version_id,
    definition_id: work.definition_id,
    status: 'published',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    source: {
      apiVersion: 'agentserver.dev/v1alpha1',
      kind: 'WorkDefinition',
      metadata: {
        name: 'supplier-research',
        description: Array.from(
          { length: large ? 500 : 2 },
          (_, i) => `Definition line ${i + 1}`,
        ).join('\n'),
      },
      spec: {
        kind: 'single_worker',
        worker_version_id: uuid(950),
        environment_version_id: uuid(951),
        memory_version_ids: [],
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
          additional_properties: false,
        },
      },
    },
    resolved: { resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}` },
    created_at: date,
    published_at: date,
    links: {
      self: `/api/v1/work-definition-versions/${work.definition_version_id}`,
      definition: `/api/v1/work-definitions/${work.definition_id}`,
    },
  };
  const version = ProductWorkDefinitionVersionSchema.parse({
    ...definition,
    source_yaml: stringify(definition.source),
  });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === 'object' && 'url' in input ? input.url : String(input),
      location.href,
    );
    const path = url.pathname;
    let body: unknown;
    if (path === '/api/auth/me')
      body = { user_id: 'reader', username: 'reader', display_name: 'Reader' };
    else if (path === '/api/agents') body = { items: coworkers };
    else if (path.endsWith('/profile'))
      body = {
        agent: { ...coworkers[0], summary: prose },
        capabilities: {
          model_policy_ref: 'free-only',
          proposal_limit: null,
          tools: [],
          skills: [],
        },
        work_catalog: [],
      };
    else if (path === '/api/conversations') body = { conversations: [] };
    else if (path === '/api/works') body = { works, next_cursor: null };
    else if (path === '/api/work-definitions')
      body = { items: [], next_cursor: null };
    else if (path.startsWith('/api/work-definition-versions/'))
      body = { version };
    else if (path === '/api/runtime-capabilities')
      body = {
        supported_runtime_capabilities: [
          'reusable_session',
          'external_workspace',
          'platform_mcp',
        ],
      };
    else if (path === '/api/work-definitions/plan')
      body = {
        valid: true,
        fingerprint: `sha256:${'c'.repeat(64)}`,
        metadata: { normalized_name: 'supplier-research' },
        resolved: {
          kind: 'single_worker',
          participants: [
            {
              name: 'Primary Worker',
              role: 'primary',
              source: 'referenced',
              worker_version_id: uuid(950),
              skills: [],
              tools: [],
            },
          ],
          environment: {
            source: 'referenced',
            environment_version_id: uuid(951),
          },
          memory_version_ids: [],
          required_runtime_capabilities: [],
          platform_capabilities: [],
          materialization: {
            inline_workers: 0,
            inline_environment: false,
            internal_team: false,
          },
        },
        diagnostics: [],
      };
    else if (path.endsWith('/session-transcripts'))
      body = {
        work_id: workId,
        work_run_id: runId,
        capture_scope: 'safe_run_events',
        sessions: [
          {
            label: {
              name: title,
              role: 'member',
              status: 'completed',
              status_basis: 'team_member_run',
              source_refs: {},
            },
            summary: {
              status: 'completed',
              entry_count: chunks.length,
              last_timestamp: date,
              last_meaningful: null,
              work_refs: [],
              truncated: false,
            },
            entries: chunks.map((text, i) => ({
              ordinal: i + 1,
              kind: 'assistant_text',
              sequence: i + 1,
              created_at: date,
              text,
            })),
          },
        ],
      };
    else if (path.endsWith('/trace')) body = { ...recordedTrace, work };
    else if (/\/runs\/[^/]+$/.test(path))
      body = {
        work,
        work_run: {
          ...recordedTrace.work_run,
          id: path.split('/').at(-1),
          result_summary: prose,
        },
        work_items: recordedTrace.work_items,
        actors: recordedTrace.actors,
        messages: recordedTrace.messages,
        projection_status: recordedTrace.projection_status,
      };
    else if (path.endsWith('/runs'))
      body = {
        work_runs: path === `/api/works/${workId}/runs` ? runs : [],
        next_cursor: null,
      };
    else if (path.endsWith('/chat'))
      body = {
        work_id: workId,
        work_run_id: path.includes('/runs/') ? runId : null,
        preparation: null,
        messages: chunks.map((body, i) => ({
          id: uuid(1100 + i),
          sequence: i + 1,
          role: 'lead',
          body,
          status: 'replied',
          reply_to_message_id: null,
          failure_code: null,
          created_at: date,
        })),
      };
    else if (path.startsWith('/api/works/')) body = { work };
    else if (path === '/api/work-items') body = { work_items: tasks };
    else if (path.endsWith('/comments'))
      body = {
        comments: Array.from({ length: count }, (_, i) => ({
          id: uuid(970 + i),
          work_item_id: taskId,
          author_id: 'principal-1',
          body: `Comment ${i}`,
          mentions: [],
          created_at: date,
        })),
      };
    else if (path === '/api/context/files')
      body = { access: 'read_write', scope: {}, entries };
    else if (path === '/api/context/file')
      body = { entry: { ...entries.at(-1), content: prose } };
    else throw new Error(`Unexpected scroll fixture request: ${path}`);
    if (path.endsWith('/session-transcripts'))
      ProductSessionTranscriptsResponseSchema.parse(body);
    if (path.endsWith('/chat')) WorkChatMessagesResponseSchema.parse(body);
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  return { commands, fetch };
}

// Inspect real geometry, including clipped children whose own boxes don't overflow.
// An overflowing hidden box clips content even if an outer ancestor can scroll.
function measurements(host: HTMLElement) {
  return [...host.querySelectorAll<HTMLElement>('*')]
    .filter(
      (el) =>
        el.clientHeight > 1 &&
        (el.scrollHeight > el.clientHeight + 1 ||
          /auto|scroll/.test(getComputedStyle(el).overflowY) ||
          ['files-rendered-markdown', 'files-file-actions'].includes(
            el.className,
          )),
    )
    .map((el) => ({
      selector: el.className || el.tagName,
      height: el.clientHeight,
      content: el.scrollHeight,
      width: el.clientWidth,
      contentWidth: el.scrollWidth,
      overflowY: getComputedStyle(el).overflowY,
      scrollTop: el.scrollTop,
      top: Math.round(el.getBoundingClientRect().top),
      bottom: Math.round(el.getBoundingClientRect().bottom),
    }));
}

const routes = [
  '/files',
  '/agents',
  `/agents/${uuid(300)}`,
  `/tasks/${taskId}`,
  '/',
  `/conversations/${uuid(500)}`,
  '/work',
  `/work/${workId}`,
  `/work/${workId}?run=${runId}`,
  `/work/${workId}?tab=overview&run=${runId}`,
  ...['overview', 'runs', 'definition', 'artifacts', 'chat'].map(
    (tab) => `/work/${workId}?tab=${tab}`,
  ),
  ...['chat', 'transcript', 'result', 'definition', 'runs', 'artifacts'].map(
    (tab) => `/work/${workId}?tab=${tab}&run=${runId}`,
  ),
  `/observe?work=${workId}&run=${runId}`,
];

const cases = routes.flatMap((route) =>
  (
    [
      ['realistic', 'en'],
      ['oversized', 'en'],
      ['oversized', 'zh-CN'],
    ] as const
  ).map(([size, locale]) => ({ route, size, locale })),
);
it.each(cases)(
  'keeps $size $locale content reachable at 1440 on $route',
  async ({ route, size, locale }) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    setLocale(locale);
    const fixture = fixtures(
      size,
      locale,
      route === `/work/${workId}?tab=chat`,
    );
    vi.stubGlobal('fetch', fixture.fetch);
    const host = document.createElement('div');
    host.style.height = '900px';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={[route]}>
            <AppProviders commands={fixture.commands}>
              <AppRouter />
            </AppProviders>
          </MemoryRouter>,
        );
      });
      // Drain React's asynchronous read chain without timed sleeps.
      for (let turn = 0; turn < 12; turn++)
        await act(async () => {
          await Promise.resolve();
        });
      expect(window.innerWidth).toBe(1440);
      expect(host.querySelector('.app-shell')).not.toBeNull();
      expect(
        host.querySelector('.app-shell')!.getBoundingClientRect().height,
      ).toBe(900);
      if (route === '/files') {
        console.log(
          'SCROLL_AUDIT',
          JSON.stringify({
            route: route + ' (list)',
            size,
            locale,
            measurements: measurements(host),
          }),
        );
        if (size === 'oversized') {
          expectScrollReachable(
            host,
            '.files-scope-list',
            ':scope > :last-child',
          );
          expectScrollReachable(host, '.files-file-list', 'button');
        }
        const file = host.querySelector<HTMLElement>(
          '.files-file-list button:last-child',
        );
        expect(file).not.toBeNull();
        await act(async () => file!.click());
        for (let turn = 0; turn < 6; turn++)
          await act(async () => {
            await Promise.resolve();
          });
      }
      console.log(
        'SCROLL_AUDIT',
        JSON.stringify({
          route,
          size,
          locale,
          measurements: measurements(host),
        }),
      );
      expectNoVerticalTraps(host);
      verifyRoute(host, route, size);
      if (route === '/files') {
        console.log(
          'SCROLL_END',
          JSON.stringify({
            route,
            size,
            locale,
            measurements: measurements(host),
          }),
        );
        await act(async () =>
          host
            .querySelector<HTMLButtonElement>(
              '.files-viewer-toolbar button:last-child',
            )!
            .click(),
        );
        expect(
          host.querySelector('.files-rendered-markdown pre')?.textContent,
        ).toContain(`Checkpoint ${size === 'oversized' ? 2000 : 8}`);
        expectNoVerticalTraps(host);
        if (size === 'oversized')
          expectScrollReachable(host, '.files-main', '.files-file-actions');
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      vi.useRealTimers();
      setLocale('en');
    }
  },
);

function verifyRoute(host: HTMLElement, route: string, size: Size) {
  const large = size === 'oversized';
  const scroller = (selector: string, last?: string) => {
    expect(host.querySelector(selector), selector).not.toBeNull();
    if (large) expectScrollReachable(host, selector, last);
  };
  if (route === '/' || route.startsWith('/conversations/')) {
    expect(host.textContent).toContain(`Checkpoint ${large ? 2000 : 8}`);
    scroller('.sidebar-section', '.conversation-item');
    scroller('.chat-transcript', '.assistant-markdown p');
    const composer = host.querySelector('textarea')!.getBoundingClientRect();
    expect(composer.bottom).toBeLessThanOrEqual(900);
  } else if (route.startsWith('/work')) {
    scroller('.work-pane-scroll', '.work-list > li');
    // Work owns one directory scroller; neither list may take scrolling back.
    expect(
      getComputedStyle(host.querySelector('.work-pane .work-list')!).overflowY,
    ).toBe('visible');
    if (route === '/work') return;
    expect(host.querySelector('.work-shell')).not.toBeNull();
    const tab =
      host.querySelector<HTMLElement>('.work-shell')!.dataset.activeTab;
    if (tab === 'chat') {
      expect(host.textContent).toContain(`Checkpoint ${large ? 2000 : 8}`);
      scroller('.work-chat-history', '.assistant-markdown p');
      const composer = host
        .querySelector('.work-chat-composer')!
        .getBoundingClientRect();
      expect(composer.bottom).toBeLessThanOrEqual(900);
      expect(composer.top).toBeGreaterThan(0);
    } else if (tab === 'runs') {
      expect(host.querySelectorAll('.work-run-list > li')).toHaveLength(
        large ? 50 : 3,
      );
      scroller('.work-main-content', '.work-run-list > li');
    } else if (tab === 'definition') {
      expect(
        host.querySelector('[data-testid="definition-viewer"]'),
      ).not.toBeNull();
      const editor = host.querySelector<HTMLTextAreaElement>(
        '.work-definition__source',
      );
      if (editor && large) {
        expect(editor.value.split('\n').length).toBeGreaterThanOrEqual(500);
        expect(['auto', 'scroll']).toContain(
          getComputedStyle(editor).overflowY,
        );
        expect(editor.scrollHeight).toBeGreaterThan(editor.clientHeight);
        editor.scrollTop = editor.scrollHeight;
        expect(editor.scrollTop).toBeGreaterThan(0);
      }
      scroller('.work-main-content', '.work-definition__facts > div');
    } else if (tab === 'transcript') {
      expect(host.textContent).toContain(`Checkpoint ${large ? 2000 : 8}`);
      scroller('.work-main-content', '.transcript__prose p');
    } else if (tab === 'result') {
      expect(host.textContent).toContain(`Checkpoint ${large ? 2000 : 8}`);
      scroller('.work-overview__outcome', '.assistant-markdown p');
      scroller('.work-main-content');
    }
  } else if (route.startsWith('/observe')) {
    expect(host.querySelector('[data-testid="observe-detail"]')).not.toBeNull();
    scroller('.observe-pane .work-list', 'li');
    scroller('.work-main-content');
  } else if (route === '/agents') {
    expect(host.querySelectorAll('.agents-roster-card')).toHaveLength(
      large ? 50 : 3,
    );
    scroller('.agents-main', '.agents-roster-add');
  } else if (route.startsWith('/agents/')) {
    expect(host.querySelector('.agents-profile-header')).not.toBeNull();
    scroller('.agents-list', '.agents-list-item');
    // The profile deliberately clamps its summary to three lines. A short
    // profile need not overflow, even when the directory contains 50 agents.
    expect(
      getComputedStyle(host.querySelector('.agents-main')!).overflowY,
    ).toBe('auto');
  } else if (route === '/files') {
    expect(host.textContent).toContain(`Checkpoint ${large ? 2000 : 8}`);
    scroller('.files-main', '.files-rendered-markdown p');
    const main = host.querySelector<HTMLElement>('.files-main')!;
    expect(main.getBoundingClientRect().height).toBe(900);
    expect(main.scrollWidth).toBe(main.clientWidth);
    const preview = host.querySelector<HTMLElement>(
      '.files-rendered-markdown',
    )!;
    const actions = host.querySelector<HTMLElement>('.files-file-actions')!;
    expect(actions.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      preview.getBoundingClientRect().bottom,
    );
    if (large)
      expectScrollReachable(host, '.files-main', '.files-file-actions');
  } else if (route.startsWith('/tasks/')) {
    expect(
      host.querySelectorAll('[data-testid="task-list-item"]'),
    ).toHaveLength(large ? 50 : 3);
    scroller('.work-org-list', '[data-testid="task-list-item"]');
    scroller('.work-org-content', '.work-org-comment');
  }
}
