export const MAX_CHANNEL_IDENTIFIER_BYTES = 512;

export function assertChannelIdentifier(
  value: string,
  label = 'identifier',
): void {
  if (
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_CHANNEL_IDENTIFIER_BYTES
  ) {
    throw new Error(`${label} is empty or too large`);
  }
}
