export function validateSkillMetadata(
  name: string,
  requiredToolRefs: readonly string[],
): void {
  if (!name || hasControlCharacter(name))
    throw new Error('Invalid Skill name.');
  if (
    requiredToolRefs.some((toolRef) => !toolRef || hasControlCharacter(toolRef))
  )
    throw new Error('Invalid Skill tool reference.');
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}
