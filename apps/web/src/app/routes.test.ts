import { describe, expect, it } from 'vitest';

import {
  parseWorkRunResultFileRoute,
  workFilePath,
  workRunResultFilePath,
} from './routes';

describe('WorkRun result-file routes', () => {
  it('binds the work scope, exact result path, selected run, and origin', () => {
    expect(
      workRunResultFilePath('work / 1', 'run / 1', 'conversation / 1'),
    ).toBe(
      '/files?scope=work&work_id=work+%2F+1&path=runs%2Frun+%2F+1%2Fresult.md&run=run+%2F+1&from_conversation=conversation+%2F+1',
    );
  });

  it('keeps a Work file scope bound to its requested path', () => {
    const path = workRunResultFilePath('work-1', 'run-1', 'conversation-1');
    expect(parseWorkRunResultFileRoute(path.slice(path.indexOf('?')))).toEqual({
      workId: 'work-1',
      path: 'runs/run-1/result.md',
      workRunId: 'run-1',
      originConversationId: 'conversation-1',
    });
    expect(
      parseWorkRunResultFileRoute(
        '?scope=work&work_id=work-1&path=runs%2Frun-2%2Fresult.md&run=run-1',
      ),
    ).toMatchObject({
      workId: 'work-1',
      path: 'runs/run-2/result.md',
      workRunId: 'run-1',
    });
  });

  it('keeps file selection and WorkRun return context together', () => {
    expect(
      workFilePath('work-1', 'notes/report.md', 'run-1', 'conversation-1'),
    ).toBe(
      '/files?scope=work&work_id=work-1&path=notes%2Freport.md&run=run-1&from_conversation=conversation-1',
    );
  });
});
