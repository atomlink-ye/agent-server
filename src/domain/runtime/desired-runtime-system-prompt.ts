import { createHash } from 'node:crypto';

export interface DesiredRuntimeSystemPrompt {
  readonly text: string;
  readonly digest: string;
}

export function createDesiredRuntimeSystemPrompt(
  text: string,
): DesiredRuntimeSystemPrompt {
  return Object.freeze({ text, digest: digestRuntimeSystemPrompt(text) });
}

export function assertDesiredRuntimeSystemPrompt(
  prompt: DesiredRuntimeSystemPrompt,
): void {
  if (digestRuntimeSystemPrompt(prompt.text) !== prompt.digest)
    throw new Error('Runtime system prompt digest is inconsistent.');
}

export function digestRuntimeSystemPrompt(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
