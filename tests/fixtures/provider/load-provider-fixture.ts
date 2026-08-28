import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ProviderFixture = Readonly<{
  schema_version: 1;
  fixture_id: string;
  provenance: 'hand_authored_contract_fixture' | 'sanitized_live_capture';
  provider: Readonly<{ family: string; model_class: string }>;
  request: Readonly<{ turn: 'continue' }>;
  completion: Readonly<{ status: 'completed'; text: string }>;
}>;

/** Fixture ids are interpolated into a path, so keep them to a safe alphabet. */
const FIXTURE_ID = /^[a-z0-9-]+$/;

export function loadProviderFixture(fixtureId: string): ProviderFixture {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error(
      `Invalid provider fixture id '${fixtureId}': use lowercase letters, numbers and hyphens only.`,
    );
  const path = fileURLToPath(new URL(`./${fixtureId}.json`, import.meta.url));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(
      `Unknown provider fixture '${fixtureId}'. Refresh it with: pnpm capture:provider-fixture -- --input <sanitized-capture.json> --fixture-id ${fixtureId}`,
    );
  }
  if (!isProviderFixture(parsed))
    throw new Error(
      `Invalid provider fixture '${fixtureId}'. Refresh it with: pnpm capture:provider-fixture -- --input <sanitized-capture.json> --fixture-id ${fixtureId}`,
    );
  return parsed;
}

function isProviderFixture(value: unknown): value is ProviderFixture {
  if (!value || typeof value !== 'object') return false;
  const fixture = value as Record<string, unknown>;
  return (
    fixture.schema_version === 1 &&
    typeof fixture.fixture_id === 'string' &&
    (fixture.provenance === 'hand_authored_contract_fixture' ||
      fixture.provenance === 'sanitized_live_capture') &&
    typeof fixture.provider === 'object' &&
    typeof fixture.request === 'object' &&
    typeof fixture.completion === 'object'
  );
}
