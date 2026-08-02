const SAFE_REF_RE =
  /^[A-Za-z0-9][A-Za-z0-9._:@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:@+-]*)*$/;

export function isSafeNativeRef(value: string): boolean {
  return (
    value.length > 0 &&
    SAFE_REF_RE.test(value) &&
    !/\s|[\u0000-\u001f\u007f\\]/u.test(value) &&
    value.split('/').every((part) => part !== '.' && part !== '..')
  );
}
