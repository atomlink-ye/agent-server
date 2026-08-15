import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const path = 'src/application/runs/execute-run.test.ts';
const base = 'c17be81831239e09872d28f1bccdbc97007e9408';
let source = execFileSync('git', ['show', `${base}:${path}`], {
  encoding: 'utf8',
  maxBuffer: 2 * 1024 * 1024,
});

const successNeedle = `    expect(requeueDirectForFailedTask).not.toHaveBeenCalled();\n    expect(reconcileForRootTask).not.toHaveBeenCalled();\n\n    await lateCallbackDriver.handleTerminalRun({`;
const successReplacement = `    expect(requeueDirectForFailedTask).not.toHaveBeenCalled();\n    expect(reconcileForRootTask).toHaveBeenCalledWith(\n      team.rootTaskId,\n      expect.objectContaining({\n        tenantId: team.tenantId,\n        workspaceId: team.workspaceId,\n        principalType: team.principalType,\n        principalId: team.principalId,\n      }),\n      { parentTask: lateDirectTask },\n    );\n\n    reconcileForRootTask.mockClear();\n    await lateCallbackDriver.handleTerminalRun({`;
if (!source.includes(successNeedle))
  throw new Error('late direct success assertion changed');
source = source.replace(successNeedle, successReplacement);

const failureNeedle = `    expect(reconcileForRootTask).toHaveBeenCalledWith(\n      team.rootTaskId,\n      expect.objectContaining({\n        tenantId: team.tenantId,\n        workspaceId: team.workspaceId,\n        principalType: team.principalType,\n        principalId: team.principalId,\n      }),\n    );\n  });\n\n  it('fails a successful work attempt when the runtime never submits canonical work'`;
const failureReplacement = `    expect(reconcileForRootTask).toHaveBeenCalledWith(\n      team.rootTaskId,\n      expect.objectContaining({\n        tenantId: team.tenantId,\n        workspaceId: team.workspaceId,\n        principalType: team.principalType,\n        principalId: team.principalId,\n      }),\n      { parentTask: lateDirectTask },\n    );\n  });\n\n  it('fails a successful work attempt when the runtime never submits canonical work'`;
if (!source.includes(failureNeedle))
  throw new Error('late direct failure assertion changed');
source = source.replace(failureNeedle, failureReplacement);

await writeFile(path, source);
console.log('execute-run characterization suite restored and migrated');
