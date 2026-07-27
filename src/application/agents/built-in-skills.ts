import { readFile } from 'node:fs/promises';

const BUILT_IN_SKILL_FILES = Object.freeze({
  'agent-server/memory-api': new URL(
    '../../../skills/agent-server-memory-api/SKILL.md',
    import.meta.url,
  ),
} as const);

export type ResolvedBuiltInSkill = Readonly<{
  readonly ref: string;
  readonly body: string;
}>;

export class UnknownBuiltInSkillError extends Error {
  public constructor() {
    super('The managed Agent references an unsupported built-in Skill.');
    this.name = 'UnknownBuiltInSkillError';
  }
}

export class DuplicateBuiltInSkillError extends Error {
  public constructor() {
    super('The managed Agent references a built-in Skill more than once.');
    this.name = 'DuplicateBuiltInSkillError';
  }
}

export async function loadBuiltInSkills(
  refs: readonly string[],
): Promise<readonly ResolvedBuiltInSkill[]> {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) throw new DuplicateBuiltInSkillError();
    seen.add(ref);
  }
  return Promise.all(
    refs.map(async (ref) => {
      const file =
        BUILT_IN_SKILL_FILES[ref as keyof typeof BUILT_IN_SKILL_FILES];
      if (!file) throw new UnknownBuiltInSkillError();
      let source: string;
      try {
        source = await readFile(file, 'utf8');
      } catch {
        throw new Error('A built-in Skill could not be loaded.');
      }
      return { ref, body: parseSkill(source, ref) };
    }),
  );
}

function parseSkill(source: string, ref: string): string {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Built-in Skill ${ref} is invalid.`);
  const frontmatter = match[1] ?? '';
  const body = match[2]?.trim();
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description || name !== ref || !body)
    throw new Error(`Built-in Skill ${ref} is invalid.`);
  return body;
}
