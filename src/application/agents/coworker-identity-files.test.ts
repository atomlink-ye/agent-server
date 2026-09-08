import { describe, expect, it } from 'vitest';

import { composeCoworkerIdentityFiles } from './coworker-identity-files.js';

describe('composeCoworkerIdentityFiles', () => {
  it('writes the identity from what the person actually typed', () => {
    const [identity] = composeCoworkerIdentityFiles({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches markets and writes concise briefs.',
    });

    expect(identity?.path).toBe('IDENTITY.md');
    expect(identity?.content).toContain('# Maya');
    expect(identity?.content).toContain('**Role:** Research Analyst');
    expect(identity?.content).toContain(
      '**Bio:** Researches markets and writes concise briefs.',
    );
  });

  it('tells the Agent the file is editable, because that is what makes it identity', () => {
    const [identity] = composeCoworkerIdentityFiles({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches markets.',
    });

    expect(identity?.content).toContain('Edit it as you grow');
  });

  it('omits SOUL.md entirely when nobody described a working style', () => {
    const files = composeCoworkerIdentityFiles({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches markets.',
    });

    expect(files.map((file) => file.path)).toEqual(['IDENTITY.md']);
  });

  it('writes SOUL.md from the working style when one was given', () => {
    const files = composeCoworkerIdentityFiles({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches markets.',
      instructions: 'Lead with the number. Never pad a brief.',
    });
    const soul = files.find((file) => file.path === 'SOUL.md');

    expect(soul?.content).toContain('# Soul of Maya');
    expect(soul?.content).toContain('Lead with the number. Never pad a brief.');
  });

  it('never invents a value the hire form did not carry', () => {
    const files = composeCoworkerIdentityFiles({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches markets.',
      instructions: '   ',
    });

    for (const file of files)
      for (const placeholder of ['TODO', 'TBD', 'N/A', '<', 'Principles'])
        expect(file.content).not.toContain(placeholder);
  });
});
