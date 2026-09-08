import type { CoworkerAuthoringDraft } from './coworker-authoring.js';

/**
 * The two files a Coworker's identity lives in, once it is hired.
 *
 * `IDENTITY.md` is what the Agent is; `SOUL.md` is how it works. They are
 * ordinary files in the Agent's own workspace, which is the point: the Agent
 * reads them at the top of every wake-up and can rewrite them with
 * `workspace_write`, so who it is stops being a value only the hire form could
 * ever set and becomes something it can grow into.
 */
export const COWORKER_IDENTITY_FILE_PATH = 'IDENTITY.md';
export const COWORKER_SOUL_FILE_PATH = 'SOUL.md';

export const COWORKER_IDENTITY_FILE_PATHS: readonly string[] = Object.freeze([
  COWORKER_IDENTITY_FILE_PATH,
  COWORKER_SOUL_FILE_PATH,
]);

export interface CoworkerIdentityFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Seeds written from what a person actually typed, and nothing else.
 *
 * A placeholder would be worse than an absent file. The Agent is told these
 * files are its own account of itself, so a templated line it never chose
 * teaches it something false about itself and, being indistinguishable from a
 * real one, is never corrected. Every section here is present only when the
 * hire form carried a value for it -- which is why a Coworker hired without a
 * working style gets no `SOUL.md` at all rather than an empty one.
 *
 * The closing line of each file is not content about the Coworker; it states
 * how the file behaves, which is true of every Coworker on this platform and
 * is the only reason the Agent knows editing it does anything.
 */
export function composeCoworkerIdentityFiles(
  draft: CoworkerAuthoringDraft,
): readonly CoworkerIdentityFile[] {
  const name = draft.name.trim();
  const role = draft.role.trim();
  const summary = draft.summary.trim();
  if (!name) throw new Error('Give this Coworker a name.');
  if (!role) throw new Error('Give this Coworker a role.');
  const workingStyle = draft.instructions?.trim() ?? '';

  const identity = [
    `# ${name}`,
    '',
    `**Role:** ${role}`,
    ...(summary ? ['', `**Bio:** ${summary}`] : []),
    '',
    '_This file is your identity. Edit it as you grow — what you write here is',
    'what you are told you are on every wake-up._',
  ].join('\n');

  if (!workingStyle)
    return Object.freeze([
      { path: COWORKER_IDENTITY_FILE_PATH, content: identity },
    ]);

  const soul = [
    `# Soul of ${name}`,
    '',
    '## Working style',
    '',
    workingStyle,
    '',
    '_This file is how you work. Edit it freely to evolve who you are._',
  ].join('\n');

  return Object.freeze([
    { path: COWORKER_IDENTITY_FILE_PATH, content: identity },
    { path: COWORKER_SOUL_FILE_PATH, content: soul },
  ]);
}
