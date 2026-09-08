import { constants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A provider CLI treats its working directory as part of whatever project
 * contains it: it walks up the tree collecting every `AGENTS.md` it passes and
 * prepends them to the Agent's first message as authoritative instructions.
 * The walk stops only at a directory holding `.git`.
 *
 * An Agent workspace placed inside a source repository therefore starts every
 * conversation by reading that repository's developer handbook -- architecture
 * rules, test commands, repo maps -- as if it were its own briefing. None of
 * that describes the Agent a person hired, and the Agent has no way to tell it
 * apart from its real instructions.
 *
 * A workspace is its own project root, so mark it as one. `.git` is the only
 * marker the walk recognizes, and the smallest thing that satisfies both the
 * walk and `git` itself is an empty repository: `HEAD`, `objects/`, `refs/`
 * and a minimal `config`. Writing it directly keeps this independent of
 * whether a `git` executable exists in the runtime image.
 */
export async function ensureAgentWorkspaceRoot(
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const gitDirectory = join(directory, '.git');
  if (await exists(gitDirectory)) return;
  await mkdir(join(gitDirectory, 'objects'), { recursive: true });
  await mkdir(join(gitDirectory, 'refs', 'heads'), { recursive: true });
  await writeFile(join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(
    join(gitDirectory, 'config'),
    ['[core]', '\trepositoryformatversion = 0', '\tbare = false', ''].join(
      '\n',
    ),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
