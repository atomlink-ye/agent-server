export const invokableVersionStatuses = ['draft', 'published'] as const;

export type InvokableVersionStatus = (typeof invokableVersionStatuses)[number];

export interface InvokableOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export function assertInvokableOwnerScope(
  scope: InvokableOwnerScope,
  label: string,
): void {
  const requiredFields = [
    ['tenantId', scope.tenantId],
    ['workspaceId', scope.workspaceId],
    ['principalType', scope.principalType],
    ['principalId', scope.principalId],
  ] as const;

  for (const [fieldName, value] of requiredFields) {
    assertNonEmptyString(fieldName, value, label);
  }
}

export function assertNonEmptyString(
  fieldName: string,
  value: string,
  label: string,
): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} field ${fieldName} must be a non-empty string`);
  }
}

export function normalizeOptionalText(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function assertIsoInstant(
  fieldName: string,
  value: string,
  label: string,
): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `${label} field ${fieldName} must be a valid ISO-8601 instant`,
    );
  }
}

export function assertCreatedAndUpdatedAt(
  createdAt: string,
  updatedAt: string,
  label: string,
): void {
  assertIsoInstant('createdAt', createdAt, label);
  assertIsoInstant('updatedAt', updatedAt, label);

  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      `${label} updatedAt must be greater than or equal to createdAt`,
    );
  }
}
