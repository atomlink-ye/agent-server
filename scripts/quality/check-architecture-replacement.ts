import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baselinePath = resolve(
  root,
  'scripts/quality/architecture-replacement-baseline.json',
);

type RuleInfo = { readonly why: string; readonly phase: string };
type Violation = RuleInfo & {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly symbol: string;
  readonly occurrence: number;
  readonly key: string;
};
type Baseline = { readonly version: 1; readonly entries: readonly Violation[] };

const ruleInfo: Readonly<Record<string, RuleInfo>> = {
  'backend.platform-tree': {
    why: 'The legacy platform tree still owns composition seams.',
    phase: 'Phase 5 — composition graph',
  },
  'backend.modules-tree': {
    why: 'The legacy modules tree still owns compatibility composition seams.',
    phase: 'Phase 6 — delete modules/resource',
  },
  'backend.compose-platform-app': {
    why: 'The platform app composer remains the legacy bootstrap facade.',
    phase: 'Phase 5 — composition graph',
  },
  'backend.platform-contribution': {
    why: 'PlatformContribution is a legacy composition contract.',
    phase: 'Phase 5 — composition graph',
  },
  'backend.register-tool-contributor': {
    why: 'Tool contributor registration remains on the legacy module seam.',
    phase: 'Phase 6 — delete modules/resource',
  },
  'backend.compatibility-session-binding': {
    why: 'Compatibility session binding remains in the execution facade.',
    phase: 'Phase 4 — facade/compat execution',
  },
  'backend.fresh-sessions': {
    why: 'The facade still caches compatibility fresh sessions.',
    phase: 'Phase 4 — facade/compat execution',
  },
  'backend.platform-import': {
    why: 'Production code still imports the legacy platform tree.',
    phase: 'Phase 5 — composition graph',
  },
  'backend.modules-import': {
    why: 'Production code still imports the legacy modules tree.',
    phase: 'Phase 6 — delete modules/resource',
  },
  'persistence.paseo-workspace-id': {
    why: 'Runtime persistence still carries the provider workspace identity.',
    phase: 'Phase 1 — runtime/persistence',
  },
  'persistence.provider-agent-id': {
    why: 'Runtime persistence still carries the provider agent binding.',
    phase: 'Phase 1 — runtime/persistence',
  },
  'persistence.session-launch-snapshots': {
    why: 'Runtime persistence still reads the compatibility launch snapshot table.',
    phase: 'Phase 1 — runtime/persistence',
  },
  'persistence.desired-spec-digest': {
    why: 'Runtime-session reconciliation still uses the legacy desired digest column.',
    phase: 'Phase 2 — reconciliation',
  },
  'persistence.extension-grant-id': {
    why: 'Runtime session generations still carry the legacy extension grant column.',
    phase: 'Phase 3 — RuntimeTurn/grant',
  },
  'frontend.product-run-trace-boundary': {
    why: 'Production frontend code must cross the ProductRunTrace contract only through the normalized run-trace boundary.',
    phase: 'Phase 10 — normalized run trace',
  },
  'frontend.use-client': {
    why: 'The browser source still carries framework-specific client directives.',
    phase: 'Phase 8 — frontend work',
  },
  'architecture.domain-imports': {
    why: 'Domain code still depends on an outer application, infrastructure, or entrypoint layer.',
    phase: 'Phase 5 — composition graph',
  },
  'architecture.application-imports': {
    why: 'Application code still depends directly on infrastructure or process composition.',
    phase: 'Phase 5 — composition graph',
  },
  'architecture.entrypoints-imports': {
    why: 'Entrypoints still construct infrastructure directly instead of receiving composition.',
    phase: 'Phase 5 — composition graph',
  },
  'architecture.infrastructure-imports': {
    why: 'Infrastructure still reaches into entrypoint or composition code.',
    phase: 'Phase 5 — composition graph',
  },
};

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...walk(path));
    else result.push(path);
  }
  return result;
}

function productionSourceFiles(dir: string): string[] {
  return walk(dir).filter(
    (path) => /\.(?:ts|tsx)$/.test(path) && !/\.test\.[^.]+$/.test(path),
  );
}

function rel(path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

function info(rule: string): RuleInfo {
  const value = ruleInfo[rule];
  if (!value) throw new Error(`Missing traceable rule mapping for ${rule}`);
  return value;
}

function violation(
  rule: string,
  path: string,
  line: number,
  symbol: string,
): Violation {
  return {
    rule,
    path,
    line,
    symbol,
    occurrence: 0,
    key: '',
    ...info(rule),
  };
}

function identityBase(
  entry: Pick<Violation, 'rule' | 'path' | 'symbol'>,
): string {
  return `${entry.rule}|${entry.path}|${entry.symbol}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineNumber(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function lineMatches(
  text: string,
  pattern: RegExp,
): readonly { readonly line: number; readonly value: string }[] {
  const matches: { line: number; value: string }[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (pattern.test(line)) matches.push({ line: index + 1, value: line });
    pattern.lastIndex = 0;
  }
  return matches;
}

function sourceLayer(path: string): string | null {
  const match = /^src\/([^/]+)\//.exec(path);
  return match?.[1] ?? null;
}

function importedLayer(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const withoutExtension = specifier.replace(/\.js$/, '');
  return sourceLayer(rel(resolve(dirname(file), withoutExtension)));
}

function staticImports(text: string): readonly {
  readonly line: number;
  readonly specifier: string;
}[] {
  const result: { line: number; specifier: string }[] = [];
  const pattern = /^\s*import\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(pattern)) {
    result.push({
      line: lineNumber(text, match.index ?? 0),
      specifier: match[1]!,
    });
  }
  const sideEffectPattern = /^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(sideEffectPattern)) {
    result.push({
      line: lineNumber(text, match.index ?? 0),
      specifier: match[1]!,
    });
  }
  result.sort((left, right) => left.line - right.line);
  return result;
}

function scanBackend(out: Violation[]): void {
  for (const directory of ['src/platform', 'src/modules']) {
    if (existsSync(resolve(root, directory))) {
      const rule =
        directory === 'src/platform'
          ? 'backend.platform-tree'
          : 'backend.modules-tree';
      out.push(violation(rule, directory, 1, `directory:${directory}`));
    }
  }

  const symbols: readonly [string, string, RegExp][] = [
    [
      'backend.compose-platform-app',
      'composePlatformApp',
      /\bcomposePlatformApp\b/,
    ],
    [
      'backend.platform-contribution',
      'PlatformContribution',
      /\bPlatformContribution\b/,
    ],
    [
      'backend.register-tool-contributor',
      'registerToolContributor',
      /\bregisterToolContributor\b/,
    ],
    [
      'backend.compatibility-session-binding',
      'compatibilitySessionBinding',
      /\bcompatibilitySessionBinding\b/,
    ],
    ['backend.fresh-sessions', '#freshSessions', /#freshSessions\b/],
  ];
  for (const file of productionSourceFiles(resolve(root, 'src'))) {
    const path = rel(file);
    const text = readFileSync(file, 'utf8');
    for (const [rule, symbol, pattern] of symbols) {
      for (const hit of lineMatches(text, pattern))
        out.push(violation(rule, path, hit.line, symbol));
    }
    for (const current of staticImports(text)) {
      const target = importedLayer(file, current.specifier);
      if (target === 'platform' || target === 'modules') {
        out.push(
          violation(
            target === 'platform'
              ? 'backend.platform-import'
              : 'backend.modules-import',
            path,
            current.line,
            current.specifier,
          ),
        );
      }
    }
  }
}

/**
 * Derived projection of reports/F5-delete-first-inventory.md, which is
 * authoritative; F5 changes must update this mapping. These keys are emitted
 * observability fields, never persistence columns.
 */
const PROTECTED_OBSERVABILITY_FIELDS: Readonly<
  Record<string, readonly string[]>
> = {
  desired_spec_digest_prefix: ['runtime.session.resolution'],
  applied_extension_grant_id_prefix: ['runtime.session.resolution'],
  extension_grant_id_prefix: ['runtime.session.timeout_diagnostics'],
};

type SqlTemplate = { readonly text: string; readonly start: number };

function sqlTemplates(text: string): readonly SqlTemplate[] {
  const templates: SqlTemplate[] = [];
  const pattern = /`(?:\\[\s\S]|[^`])*`/g;
  for (const match of text.matchAll(pattern)) {
    templates.push({
      text: match[0]!.slice(1, -1),
      start: match.index ?? 0,
    });
  }
  return templates;
}

function assertPersistenceField(field: string): void {
  const events = PROTECTED_OBSERVABILITY_FIELDS[field];
  if (events)
    throw new Error(
      `F5 protected observability field ${field} (${events.join(', ')}) is not a persistence column; keep it out of architecture-replacement persistence rules.`,
    );
}

function scanPersistence(out: Violation[]): void {
  const fieldRules: readonly [string, string, RegExp][] = [
    [
      'paseo_workspace_id',
      'persistence.paseo-workspace-id',
      /\bruntime_sessions\b/,
    ],
    [
      'provider_agent_id',
      'persistence.provider-agent-id',
      /\bruntime_sessions\b/,
    ],
    [
      'session_launch_snapshots',
      'persistence.session-launch-snapshots',
      /\bsession_launch_snapshots\b/,
    ],
    [
      'desired_spec_digest',
      'persistence.desired-spec-digest',
      /\bruntime_sessions\b/,
    ],
    [
      'extension_grant_id',
      'persistence.extension-grant-id',
      /\bruntime_session_generations\b/,
    ],
  ];
  for (const [field] of fieldRules) assertPersistenceField(field);

  for (const file of productionSourceFiles(resolve(root, 'src'))) {
    if (file.includes('/src/infrastructure/postgres/migrations/')) continue;
    const path = rel(file);
    const source = readFileSync(file, 'utf8');
    for (const sql of sqlTemplates(source)) {
      for (const [field, rule, owningTable] of fieldRules) {
        if (!owningTable.test(sql.text)) continue;
        const fieldPattern = new RegExp(`\\b${field}\\b`, 'g');
        for (const match of sql.text.matchAll(fieldPattern)) {
          const offset = sql.start + 1 + (match.index ?? 0);
          out.push(violation(rule, path, lineNumber(source, offset), field));
        }
      }
    }
  }
}

function scanFrontend(out: Violation[]): void {
  const frontendRoot = resolve(root, 'apps/web/src');
  const files = productionSourceFiles(frontendRoot);
  const normalizedTracePath = 'apps/web/src/features/run-trace/normalized.ts';
  const productRunTracePattern = /\bProductRunTrace\b/g;
  for (const file of files) {
    const path = rel(file);
    const text = readFileSync(file, 'utf8');
    for (const hit of lineMatches(text, /^\s*['"]use client['"];?\s*$/))
      out.push(violation('frontend.use-client', path, hit.line, 'use client'));

    if (path === normalizedTracePath) continue;
    for (const [index, line] of text.split('\n').entries()) {
      for (const match of line.matchAll(productRunTracePattern))
        out.push(
          violation(
            'frontend.product-run-trace-boundary',
            path,
            index + 1,
            match[0],
          ),
        );
    }
  }
}

function scanImportArchitecture(out: Violation[]): void {
  const forbidden: Readonly<Record<string, readonly string[]>> = {
    domain: ['application', 'infrastructure', 'entrypoints', 'composition'],
    application: ['infrastructure', 'entrypoints', 'composition'],
    entrypoints: ['infrastructure'],
    infrastructure: ['entrypoints', 'composition'],
  };
  const ruleFor: Readonly<Record<string, string>> = {
    domain: 'architecture.domain-imports',
    application: 'architecture.application-imports',
    entrypoints: 'architecture.entrypoints-imports',
    infrastructure: 'architecture.infrastructure-imports',
  };
  for (const file of productionSourceFiles(resolve(root, 'src'))) {
    const path = rel(file);
    const from = sourceLayer(path);
    if (!from || !forbidden[from]) continue;
    const text = readFileSync(file, 'utf8');
    for (const current of staticImports(text)) {
      const target = importedLayer(file, current.specifier);
      if (!target || !forbidden[from]!.includes(target)) continue;
      out.push(
        violation(
          ruleFor[from]!,
          path,
          current.line,
          `${from}->${target}:${current.specifier}`,
        ),
      );
    }
  }
}

function scan(): readonly Violation[] {
  const violations: Violation[] = [];
  scanBackend(violations);
  scanPersistence(violations);
  scanFrontend(violations);
  scanImportArchitecture(violations);
  const ordered = violations
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const baseComparison = compare(
        identityBase(left.entry),
        identityBase(right.entry),
      );
      if (baseComparison !== 0) return baseComparison;
      if (left.entry.line !== right.entry.line)
        return left.entry.line - right.entry.line;
      return left.index - right.index;
    });
  const occurrences = new Map<string, number>();
  return ordered.map(({ entry }) => {
    const base = identityBase(entry);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      ...entry,
      occurrence,
      key: `${base}|${String(occurrence).padStart(6, '0')}`,
    };
  });
}

function readBaseline(): Baseline {
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries))
    throw new Error(
      `Invalid architecture replacement baseline: ${baselinePath}`,
    );
  return parsed;
}

const current = scan();
if (process.argv.includes('--write-baseline')) {
  const baseline: Baseline = { version: 1, entries: current };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(
    `architecture-replacement: wrote ${current.length} baseline entries to ${rel(baselinePath)}\n`,
  );
  process.exit(0);
}

const baseline = readBaseline();
const currentKeys = new Set(current.map((entry) => entry.key));
const baselineKeys = new Set(baseline.entries.map((entry) => entry.key));
const added = current.filter((entry) => !baselineKeys.has(entry.key));
const stale = baseline.entries.filter((entry) => !currentKeys.has(entry.key));

process.stdout.write(
  `architecture-replacement: ${current.length} current violations, ${baseline.entries.length} baseline entries\n`,
);
if (added.length)
  process.stderr.write(
    `architecture-replacement: new (${added.length})\n${added
      .slice(0, 20)
      .map((entry) => `  ${entry.key}`)
      .join('\n')}\n`,
  );
if (stale.length)
  process.stderr.write(
    `architecture-replacement: stale baseline (${stale.length})\n${stale
      .slice(0, 20)
      .map((entry) => `  ${entry.key}`)
      .join('\n')}\n`,
  );
if (!added.length && !stale.length)
  process.stdout.write('architecture-replacement: ok\n');
else process.exitCode = 1;
