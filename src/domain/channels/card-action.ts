export const MAX_CARD_ACTION_TOKEN_BYTES = 256;

export function assertCardActionToken(value: string): void {
  if (
    value.trim().length === 0 ||
    /\s/.test(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_CARD_ACTION_TOKEN_BYTES
  ) {
    throw new Error('invalid callback token');
  }
}
