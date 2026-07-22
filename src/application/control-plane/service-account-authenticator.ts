import {
  SERVICE_ACCOUNT_PRINCIPAL_TYPE,
  type ServiceAccountAccessContext,
} from './access-context.js';

export interface ServiceAccountRecord {
  readonly serviceAccountId: string;
  readonly token: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly policyVersion: string;
  readonly disabled: boolean;
}

export type ServiceAccountAuthenticationFailureReason =
  'missing' | 'malformed' | 'unknown' | 'disabled';

export type ServiceAccountAuthenticationResult =
  | {
      readonly ok: true;
      readonly accessContext: ServiceAccountAccessContext;
    }
  | {
      readonly ok: false;
      readonly reason: ServiceAccountAuthenticationFailureReason;
    };

export class ServiceAccountAuthenticator {
  readonly #accountsByToken: ReadonlyMap<string, ServiceAccountRecord>;

  public constructor(accounts: readonly ServiceAccountRecord[]) {
    this.#accountsByToken = new Map(
      accounts.map((account) => [
        account.token,
        freezeServiceAccountRecord(account),
      ]),
    );
  }

  public authenticate(
    authorizationHeader: string | undefined,
  ): ServiceAccountAuthenticationResult {
    const token = parseBearerToken(authorizationHeader);

    if (!token.ok) {
      return token;
    }

    const account = this.#accountsByToken.get(token.value);
    if (!account) {
      return { ok: false, reason: 'unknown' };
    }

    if (account.disabled) {
      return { ok: false, reason: 'disabled' };
    }

    return {
      ok: true,
      accessContext: Object.freeze({
        tenantId: account.tenantId,
        workspaceId: account.workspaceId,
        principalType: SERVICE_ACCOUNT_PRINCIPAL_TYPE,
        principalId: account.serviceAccountId,
        serviceAccountId: account.serviceAccountId,
        policySnapshotVersion: account.policyVersion,
      }),
    };
  }
}

function parseBearerToken(authorizationHeader: string | undefined):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'malformed';
    } {
  if (authorizationHeader === undefined) {
    return { ok: false, reason: 'missing' };
  }

  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();

  if (!token) {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, value: token };
}

function freezeServiceAccountRecord(
  account: ServiceAccountRecord,
): ServiceAccountRecord {
  return Object.freeze({ ...account });
}
