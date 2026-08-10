const MAX_SAFE_TEXT_LENGTH = 4096;

export function safeText(
  value: string | null,
  limit = MAX_SAFE_TEXT_LENGTH,
): string | null {
  if (value === null) return null;
  return value
    .replace(/bearer\s+(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '[redacted]')
    .replace(
      /["']?\b(?:(?:access|refresh|id)[-_ ]?token|credential|token|password|secret|api[-_ ]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      '[redacted]',
    )
    .replace(
      /(?:^|[\s"'=])(?:~\/|\/|[A-Za-z]:\\)[^\s"'`]+/g,
      '$1[redacted path]',
    )
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit);
}
