import { beforeEach, describe, expect, it, vi } from 'vitest';

const UUIDS = {
  workspace: '11111111-1111-4111-8111-111111111111',
  teamVersion: '22222222-2222-4222-8222-222222222222',
  environmentVersion: '33333333-3333-4333-8333-333333333333',
  rootTask: '44444444-4444-4444-8444-444444444444',
  teamRun: '55555555-5555-4555-8555-555555555555',
  members: [
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
  ],
};

const upstream = vi.hoisted(() => ({
  getAgenticTeamConfig: vi.fn(),
  getAgenticTeamProject: vi.fn(),
}));

vi.mock('./agent-server-client', async () => {
  const actual = await vi.importActual<typeof import('./agent-server-client')>(
    './agent-server-client',
  );
  return { ...actual, ...upstream };
});

import { getProject, getSession } from './agentic-team-bff';

const keys = (value: Readonly<Record<string, unknown>>) =>
  Object.keys(value).sort();

const projectKeys = [
  'direct_messages',
  'final_text',
  'gates',
  'name',
  'phase',
  'root_task_id',
  'sessions',
  'status',
  'team_run_id',
  'work_items',
];
const workItemKeys = [
  'assignee_name',
  'dependency_refs',
  'latest_attempt',
  'status',
  'subject',
  'work_ref',
];
const attemptKeys = [
  'attempt_no',
  'feedback_summary',
  'result_summary',
  'status',
];
const gateKeys = [
  'all_members_idle',
  'all_work_accepted',
  'finish_ready',
  'no_active_attempts',
];
const directMessageKeys = [
  'created_at',
  'recipient_name',
  'sender_name',
  'sequence',
  'status',
  'summary',
];
const projectSessionKeys = [
  'agent_session_id',
  'latest_summary',
  'name',
  'role',
  'status',
];
const sessionKeys = [
  'agent_session_id',
  'name',
  'read_only',
  'role',
  'team_run_id',
  'turns',
];
const turnKeys = [
  'assignment_summary',
  'result_summary',
  'run_id',
  'sequence',
  'status',
  'task_id',
];

type UpstreamOverrides = {
  project?: Record<string, unknown>;
  workItem?: Record<string, unknown>;
  attempt?: Record<string, unknown> | null;
  directMessage?: Record<string, unknown>;
  sessions?: Record<string, unknown>[];
};

function makeProject(overrides: UpstreamOverrides = {}) {
  const attempt =
    overrides.attempt === null
      ? null
      : {
          attempt_no: 2,
          status: 'completed',
          feedback_summary: 'Upstream feedback is preserved.',
          result_summary: 'Upstream result is preserved.',
          ...overrides.attempt,
        };
  const workItem = {
    work_ref: 'work-42',
    subject: 'Implement the real work item',
    status: 'pending',
    assignee_name: 'Builder Bea',
    dependency_refs: ['work-1', 'work-2'],
    latest_attempt: attempt,
    ignored_work_item_field: 'drop this',
    ...overrides.workItem,
  };
  const directMessage = {
    sequence: 4,
    sender_name: 'Lead Anna',
    recipient_name: 'Builder Bea',
    summary: 'Please include the upstream coordination summary.',
    created_at: '2026-08-07T01:02:03.000Z',
    status: 'delivered',
    ignored_message_field: 'drop this',
    ...overrides.directMessage,
  };
  const sessions =
    overrides.sessions ??
    UUIDS.members.map((memberId, index) => ({
      team_member_run_id: memberId,
      name: ['Lead Anna', 'Builder Bea', 'Reviewer Rei'][index],
      role: index === 0 ? 'lead' : 'member',
      status: 'active',
      turns: [
        {
          task_id: `99999999-9999-4999-8999-99999999999${index + 1}`,
          run_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
          sequence: 1,
          kind: 'work_attempt',
          status: 'completed',
          context: `Assignment context for member ${index}.`,
          result_text: `Latest upstream result for member ${index}.`,
          attempt_no: 1,
          work_item_id: null,
          attempt_id: null,
          created_at: '2026-08-07T01:02:03.000Z',
          updated_at: '2026-08-07T01:02:04.000Z',
          ignored_turn_field: 'drop this',
        },
      ],
      ignored_session_field: 'drop this',
    }));

  return {
    project: {
      root_task_id: UUIDS.rootTask,
      team_run_id: UUIDS.teamRun,
      team_version_id: UUIDS.teamVersion,
      status: 'succeeded',
      phase: 'done',
      final_text: 'The actual final project text from upstream.',
      created_at: '2026-08-07T01:02:03.000Z',
      updated_at: '2026-08-07T01:02:04.000Z',
      ignored_project_field: 'drop this',
      ...overrides.project,
    },
    work_items: [workItem],
    gates: {
      finish_ready: true,
      all_work_accepted: false,
      no_active_attempts: true,
      all_members_idle: false,
      ignored_gate_field: 'drop this',
    },
    direct_messages: [directMessage],
    sessions,
    ignored_response_field: 'drop this',
  };
}

function setProject(value: unknown) {
  upstream.getAgenticTeamProject.mockResolvedValue(value as never);
}

type PathPart = string | number;

function setPath(value: unknown, path: readonly PathPart[], next: unknown) {
  if (path.length === 0) throw new Error('cannot mutate an empty path');
  let cursor: unknown = value;
  for (const part of path.slice(0, -1)) {
    cursor =
      typeof part === 'number'
        ? (cursor as unknown[])[part]
        : (cursor as Record<string, unknown>)[part];
  }
  const last = path[path.length - 1];
  if (typeof last === 'number') (cursor as unknown[])[last] = next;
  else (cursor as Record<string, unknown>)[last] = next;
}

function deletePath(value: unknown, path: readonly PathPart[]) {
  if (path.length === 0) throw new Error('cannot delete an empty path');
  let cursor: unknown = value;
  for (const part of path.slice(0, -1)) {
    cursor =
      typeof part === 'number'
        ? (cursor as unknown[])[part]
        : (cursor as Record<string, unknown>)[part];
  }
  const last = path[path.length - 1];
  if (typeof last === 'number') delete (cursor as unknown[])[last];
  else delete (cursor as Record<string, unknown>)[last];
}

function readPath(value: unknown, path: readonly PathPart[]): unknown {
  let cursor: unknown = value;
  for (const part of path) {
    cursor =
      typeof part === 'number'
        ? (cursor as unknown[])[part]
        : (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

type TextCase = {
  label: string;
  inputPath: readonly PathPart[];
  outputPath: readonly PathPart[];
  max: number;
  nullable: boolean;
  textFactory?: (max: number) => string;
};

const projectTextCases: readonly TextCase[] = [
  {
    label: 'project final_text',
    inputPath: ['project', 'final_text'],
    outputPath: ['final_text'],
    max: 4096,
    nullable: true,
  },
  {
    label: 'work subject',
    inputPath: ['work_items', 0, 'subject'],
    outputPath: ['work_items', 0, 'subject'],
    max: 4096,
    nullable: false,
  },
  {
    label: 'work work_ref',
    inputPath: ['work_items', 0, 'work_ref'],
    outputPath: ['work_items', 0, 'work_ref'],
    max: 64,
    nullable: false,
    textFactory: (max: number) => `work-${'7'.repeat(max - 4)}`,
  },
  {
    label: 'work assignee_name',
    inputPath: ['work_items', 0, 'assignee_name'],
    outputPath: ['work_items', 0, 'assignee_name'],
    max: 512,
    nullable: true,
  },
  {
    label: 'work dependency_refs',
    inputPath: ['work_items', 0, 'dependency_refs', 0],
    outputPath: ['work_items', 0, 'dependency_refs', 0],
    max: 64,
    nullable: false,
  },
  {
    label: 'attempt feedback_summary',
    inputPath: ['work_items', 0, 'latest_attempt', 'feedback_summary'],
    outputPath: ['work_items', 0, 'latest_attempt', 'feedback_summary'],
    max: 4096,
    nullable: true,
  },
  {
    label: 'attempt result_summary',
    inputPath: ['work_items', 0, 'latest_attempt', 'result_summary'],
    outputPath: ['work_items', 0, 'latest_attempt', 'result_summary'],
    max: 4096,
    nullable: true,
  },
  {
    label: 'direct message sender_name',
    inputPath: ['direct_messages', 0, 'sender_name'],
    outputPath: ['direct_messages', 0, 'sender_name'],
    max: 512,
    nullable: false,
  },
  {
    label: 'direct message recipient_name',
    inputPath: ['direct_messages', 0, 'recipient_name'],
    outputPath: ['direct_messages', 0, 'recipient_name'],
    max: 512,
    nullable: false,
  },
  {
    label: 'direct message summary',
    inputPath: ['direct_messages', 0, 'summary'],
    outputPath: ['direct_messages', 0, 'summary'],
    max: 4096,
    nullable: false,
  },
  {
    label: 'project session name',
    inputPath: ['sessions', 0, 'name'],
    outputPath: ['sessions', 0, 'name'],
    max: 512,
    nullable: false,
  },
  {
    label: 'project latest turn result_text',
    inputPath: ['sessions', 0, 'turns', 0, 'result_text'],
    outputPath: ['sessions', 0, 'latest_summary'],
    max: 4096,
    nullable: true,
  },
];

const sessionTextCases: readonly TextCase[] = [
  {
    label: 'session name',
    inputPath: ['sessions', 1, 'name'],
    outputPath: ['name'],
    max: 512,
    nullable: false,
  },
  {
    label: 'turn context',
    inputPath: ['sessions', 1, 'turns', 0, 'context'],
    outputPath: ['turns', 0, 'assignment_summary'],
    max: 4096,
    nullable: false,
  },
  {
    label: 'turn result_text',
    inputPath: ['sessions', 1, 'turns', 0, 'result_text'],
    outputPath: ['turns', 0, 'result_summary'],
    max: 4096,
    nullable: true,
  },
];

beforeEach(() => {
  upstream.getAgenticTeamConfig.mockReturnValue({
    workspaceId: UUIDS.workspace,
    teamVersionId: UUIDS.teamVersion,
    environmentVersionId: UUIDS.environmentVersion,
  });
  upstream.getAgenticTeamProject.mockReset();
});

describe('agentic team BFF project projection', () => {
  it('passes through real upstream fields while enforcing each output whitelist', async () => {
    setProject(makeProject());

    const result = await getProject();
    expect(result).not.toBeNull();
    expect(keys(result!)).toEqual(projectKeys);
    expect(result).toMatchObject({
      root_task_id: UUIDS.rootTask,
      team_run_id: UUIDS.teamRun,
      final_text: 'The actual final project text from upstream.',
      work_items: [
        {
          work_ref: 'work-42',
          subject: 'Implement the real work item',
          assignee_name: 'Builder Bea',
          dependency_refs: ['work-1', 'work-2'],
          latest_attempt: {
            attempt_no: 2,
            feedback_summary: 'Upstream feedback is preserved.',
            result_summary: 'Upstream result is preserved.',
          },
        },
      ],
      direct_messages: [
        {
          sender_name: 'Lead Anna',
          recipient_name: 'Builder Bea',
          summary: 'Please include the upstream coordination summary.',
        },
      ],
      sessions: [
        {
          name: 'Lead Anna',
          latest_summary: 'Latest upstream result for member 0.',
        },
        {
          name: 'Builder Bea',
          latest_summary: 'Latest upstream result for member 1.',
        },
        {
          name: 'Reviewer Rei',
          latest_summary: 'Latest upstream result for member 2.',
        },
      ],
    });

    const workItem = result!.work_items[0];
    expect(keys(workItem)).toEqual(workItemKeys);
    expect(keys(workItem.latest_attempt!)).toEqual(attemptKeys);
    expect(keys(result!.gates)).toEqual(gateKeys);
    expect(keys(result!.direct_messages[0])).toEqual(directMessageKeys);
    for (const session of result!.sessions) {
      expect(keys(session)).toEqual(projectSessionKeys);
    }
  });

  it.each([
    'pending',
    'in_progress',
    'completed',
    'blocked',
    'cancelled',
    'open',
    'accepted',
  ])(
    'accepts the real upstream work-item status %s without mapping or 500',
    async (status) => {
      setProject(makeProject({ workItem: { status } }));

      await expect(getProject()).resolves.toMatchObject({
        work_items: [{ status }],
      });
    },
  );

  it.each(['ready', 'submitted', 'changes_requested', 'unknown'])(
    'rejects legacy or unknown work-item status %s',
    async (status) => {
      setProject(makeProject({ workItem: { status } }));

      await expect(getProject()).rejects.toMatchObject({ kind: 'bad_gateway' });
    },
  );

  it.each(projectTextCases)(
    'truncates $label at its max length',
    async (textCase) => {
      const project = makeProject();
      const longText =
        textCase.textFactory?.(textCase.max) ?? 'x'.repeat(textCase.max + 1);
      setPath(project, textCase.inputPath, longText);
      setProject(project);

      const result = await getProject();
      expect(readPath(result, textCase.outputPath)).toBe(
        longText.slice(0, textCase.max),
      );
    },
  );

  it.each(projectTextCases)(
    'fails closed for non-string $label',
    async (textCase) => {
      const project = makeProject();
      setPath(project, textCase.inputPath, 42);
      setProject(project);

      await expect(getProject()).rejects.toMatchObject({ kind: 'bad_gateway' });
    },
  );

  it.each(projectTextCases.filter((textCase) => textCase.nullable))(
    'preserves null for nullable $label',
    async (textCase) => {
      const project = makeProject();
      setPath(project, textCase.inputPath, null);
      setProject(project);

      const result = await getProject();
      expect(readPath(result, textCase.outputPath)).toBeNull();
    },
  );

  it.each([
    ['work_items', ['work_items']],
    ['gates', ['gates']],
    ['direct_messages', ['direct_messages']],
    ['sessions', ['sessions']],
    ['phase', ['project', 'phase']],
  ] as const)(
    'rejects a missing projection field: %s',
    async (_label, path) => {
      const project = makeProject();
      deletePath(project, path);
      setProject(project);

      await expect(getProject()).rejects.toMatchObject({ kind: 'bad_gateway' });
    },
  );

  it('truncates bounded text, preserves null, and keeps the truncated fields', async () => {
    const longText = 'x'.repeat(4097);
    const longName = 'n'.repeat(513);
    const longWorkRef = `work-${'7'.repeat(60)}`;
    setProject(
      makeProject({
        project: { final_text: longText },
        attempt: {
          feedback_summary: null,
          result_summary: null,
        },
        workItem: {
          work_ref: longWorkRef,
        },
        sessions: UUIDS.members.map((memberId, index) => ({
          team_member_run_id: memberId,
          name: index === 0 ? longName : `Member ${index}`,
          role: index === 0 ? 'lead' : 'member',
          status: 'active',
          turns: [],
        })),
      }),
    );

    const result = await getProject();
    expect(result!.final_text).toBe(longText.slice(0, 4096));
    expect(result!.work_items[0].work_ref).toBe(longWorkRef.slice(0, 64));
    expect(result!.work_items[0].latest_attempt).toMatchObject({
      feedback_summary: null,
      result_summary: null,
    });
    expect(result!.sessions[0].name).toBe(longName.slice(0, 512));
  });

  it('fails closed on representative malformed upstream text', async () => {
    setProject(makeProject({ project: { final_text: 42 } }));

    await expect(getProject()).rejects.toMatchObject({ kind: 'bad_gateway' });
  });
});

describe('agentic team BFF session projection', () => {
  it.each(sessionTextCases)(
    'truncates $label at its max length',
    async (textCase) => {
      const project = makeProject();
      const longText = 'x'.repeat(textCase.max + 1);
      setPath(project, textCase.inputPath, longText);
      setProject(project);

      const result = await getSession(undefined, UUIDS.members[1]);
      expect(readPath(result, textCase.outputPath)).toBe(
        longText.slice(0, textCase.max),
      );
    },
  );

  it.each(sessionTextCases)(
    'fails closed for non-string $label',
    async (textCase) => {
      const project = makeProject();
      setPath(project, textCase.inputPath, 42);
      setProject(project);

      await expect(
        getSession(undefined, UUIDS.members[1]),
      ).rejects.toMatchObject({ kind: 'bad_gateway' });
    },
  );

  it.each(sessionTextCases.filter((textCase) => textCase.nullable))(
    'preserves null for nullable $label',
    async (textCase) => {
      const project = makeProject();
      setPath(project, textCase.inputPath, null);
      setProject(project);

      const result = await getSession(undefined, UUIDS.members[1]);
      expect(readPath(result, textCase.outputPath)).toBeNull();
    },
  );

  it('uses the real session name, turn context, and result text with a strict key set', async () => {
    setProject(makeProject());

    const result = await getSession(undefined, UUIDS.members[1]);
    expect(keys(result)).toEqual(sessionKeys);
    expect(result.name).toBe('Builder Bea');
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      assignment_summary: 'Assignment context for member 1.',
      result_summary: 'Latest upstream result for member 1.',
    });
    expect(keys(result.turns[0])).toEqual(turnKeys);
  });

  it('preserves null turn results', async () => {
    const project = makeProject();
    const session = project.sessions![1] as Record<string, unknown>;
    const turns = session.turns as Record<string, unknown>[];
    turns[0] = { ...turns[0], result_text: null };
    setProject(project);

    const result = await getSession(undefined, UUIDS.members[1]);
    expect(result.turns[0].result_summary).toBeNull();
  });

  it('fails closed on malformed turn result text', async () => {
    const project = makeProject();
    const session = project.sessions![1] as Record<string, unknown>;
    const turns = session.turns as Record<string, unknown>[];
    turns[0] = { ...turns[0], result_text: 42 };
    setProject(project);

    await expect(getSession(undefined, UUIDS.members[1])).rejects.toMatchObject(
      { kind: 'bad_gateway' },
    );
  });
});
