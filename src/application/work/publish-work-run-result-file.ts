import { workContextScope } from '../../domain/context/context-fs.js';
import type {
  LogicalFileEntry,
  LogicalFileStore,
} from '../ports/logical-file-store.js';
import type { WorkRunCompositionManifest } from '../ports/work-run-resource-manifest-read.js';

/**
 * Canonical location of a WorkRun's own result inside its Work scope.
 *
 * One file per run rather than one per Work: a Work is run repeatedly, and
 * overwriting a single `result.md` would silently destroy the previous run's
 * output the moment a user ran the same Work twice.
 */
export function workRunResultPath(workRunId: string): string {
  return `runs/${workRunId}/result.md`;
}

/**
 * Writes a completed WorkRun's result into the Work canonical scope so the
 * Files surface can show something the user's own run produced.
 *
 * Before this existed the ContextFS read surface was healthy and every
 * canonical scope was empty, because nothing in the ordinary Work execution
 * path ever wrote a file - only the manual promotion and memory paths did.
 */
export class PublishWorkRunResultFile {
  public constructor(private readonly files: LogicalFileStore) {}

  public async publish(input: {
    readonly manifest: WorkRunCompositionManifest;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly text: string;
  }): Promise<LogicalFileEntry> {
    return this.files.write({
      scope: workContextScope({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workId: input.manifest.workId,
      }),
      path: workRunResultPath(input.manifest.workRunId),
      // An empty completion is written as an empty file rather than skipped.
      // Skipping would put the surface back into the state this exists to fix:
      // a run that finished successfully and left nothing behind to look at.
      content: input.text,
    });
  }
}
