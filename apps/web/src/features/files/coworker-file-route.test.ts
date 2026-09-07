import { describe, expect, it } from 'vitest';

import {
  coworkerFilePath,
  hasCoworkerFileScopeQuery,
  parseCoworkerFileRoute,
} from './coworker-file-route';

const agentId = '123e4567-e89b-42d3-a456-426614174000';

describe('Coworker Files routes', () => {
  it('keeps the scope, Coworker identity, and selected path together', () => {
    const path = coworkerFilePath('agent_user', agentId, 'notes/brief.md');
    expect(path).toBe(
      `/files?scope=agent_user&agent_definition_id=${agentId}&path=notes%2Fbrief.md`,
    );
    expect(parseCoworkerFileRoute(path.slice(path.indexOf('?')))).toEqual({
      scope: 'agent_user',
      agentDefinitionId: agentId,
      path: 'notes/brief.md',
    });
  });

  it('rejects a missing or invalid Coworker identity', () => {
    expect(parseCoworkerFileRoute('?scope=agent')).toBeNull();
    expect(
      parseCoworkerFileRoute('?scope=agent&agent_definition_id=not-an-agent'),
    ).toBeNull();
    expect(hasCoworkerFileScopeQuery('?scope=agent')).toBe(true);
  });

  it('ignores unsupported scopes and retains Work result routing priority', () => {
    expect(
      parseCoworkerFileRoute(
        '?scope=workspace&agent_definition_id=123e4567-e89b-42d3-a456-426614174000',
      ),
    ).toBeNull();
    expect(
      parseCoworkerFileRoute('?scope=work&work_id=work-1&path=result.md'),
    ).toBeNull();
    expect(hasCoworkerFileScopeQuery('?scope=work&work_id=work-1')).toBe(false);
  });
});
