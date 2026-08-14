import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const schemaFile = join(repositoryRoot, 'src/contracts/teams.ts');
const baselineFile = join(
  repositoryRoot,
  'fixtures/contracts/legacy-team-project-schema.sha256',
);

// This immutable set was generated from the frozen legacy schema at S2 start.
// Keep it in the checker so the fixture digest remains a one-way guard and the
// checker can report added/removed leaves without rewriting the fixture.
const BASELINE_LEAVES = [
  'direct_messages[].created_at',
  'direct_messages[].recipient_name',
  'direct_messages[].sender_name',
  'direct_messages[].sequence',
  'direct_messages[].status',
  'direct_messages[].summary',
  'gates.all_members_idle',
  'gates.all_work_accepted',
  'gates.finish_ready',
  'gates.no_active_attempts',
  'project.completion_approval_required',
  'project.completion_decisions[].completion_requested_by_run_id',
  'project.completion_decisions[].decided_at',
  'project.completion_decisions[].decided_by',
  'project.completion_decisions[].decision',
  'project.completion_decisions[].feedback',
  'project.completion_decisions[].id',
  'project.completion_decisions[].lead_turn_count_at_decision',
  'project.completion_decisions[].targets[].attempt_no_at_decision',
  'project.completion_decisions[].targets[].work_item_id',
  'project.completion_decisions[].team_revision_at_decision',
  'project.completion_decisions[].team_run_id',
  'project.created_at',
  'project.final_text',
  'project.phase',
  'project.revision',
  'project.root_task_id',
  'project.status',
  'project.stop_reason',
  'project.team_run_id',
  'project.team_version_id',
  'project.updated_at',
  'sessions[].name',
  'sessions[].role',
  'sessions[].status',
  'sessions[].team_member_run_id',
  'sessions[].turns[].attempt_id',
  'sessions[].turns[].attempt_no',
  'sessions[].turns[].context',
  'sessions[].turns[].created_at',
  'sessions[].turns[].kind',
  'sessions[].turns[].model',
  'sessions[].turns[].provider',
  'sessions[].turns[].result_text',
  'sessions[].turns[].run_id',
  'sessions[].turns[].sequence',
  'sessions[].turns[].status',
  'sessions[].turns[].task_id',
  'sessions[].turns[].updated_at',
  'sessions[].turns[].work_item_id',
  'work_items[].assignee_name',
  'work_items[].attempts[].attempt_no',
  'work_items[].attempts[].feedback_summary',
  'work_items[].attempts[].result_summary',
  'work_items[].attempts[].status',
  'work_items[].dependency_refs',
  'work_items[].description',
  'work_items[].latest_attempt.attempt_no',
  'work_items[].latest_attempt.feedback_summary',
  'work_items[].latest_attempt.result_summary',
  'work_items[].latest_attempt.status',
  'work_items[].status',
  'work_items[].subject',
  'work_items[].work_ref',
];

const source = await readFile(schemaFile, 'utf8');
const leaves = extractLegacyLeaves(source);
const normalized = leaves.join('\n') + '\n';
const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');

if (process.argv.includes('--print-leaves')) {
  process.stdout.write(normalized);
  process.exit(0);
}

const baseline = (await readFile(baselineFile, 'utf8')).trim().split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/.test(baseline)) {
  process.stderr.write(`Legacy schema baseline is invalid: ${baselineFile}\n`);
  process.exitCode = 1;
} else {
  // Compare sets so a rename is reported as one addition and one removal.
  const baselineLeaves = BASELINE_LEAVES;
  const expected = new Set(baselineLeaves);
  const actual = new Set(leaves);
  const added = [...actual].filter((leaf) => !expected.has(leaf));
  const removed = [...expected].filter((leaf) => !actual.has(leaf));
  process.stdout.write(
    `legacy_leaf_added=${added.length} legacy_leaf_removed=${removed.length} hash=${hash}\n`,
  );
  if (added.length > 0 || removed.length > 0 || hash !== baseline) {
    process.stderr.write(
      `Legacy team project schema changed. added=${added.join(',')} removed=${removed.join(',')}\n`,
    );
    process.exitCode = 1;
  }
}

/**
 * The fixture stores the digest of the normalized leaf set.  The baseline
 * file intentionally does not store the set itself: this check never writes
 * or re-records a baseline.  For a matching baseline, derive its expected
 * set from the frozen source and keep the digest as the immutable guard.
 *
 * A changed source is rejected by the digest comparison below.  The set
 * comparison remains useful for a future baseline that carries a sidecar
 * leaf list, while preserving the current one-file fixture contract.
 */
function extractLegacyLeaves(source) {
  const definitions = collectObjectDefinitions(source);
  const root = definitions.get('AgenticTeamProjectResponseSchema');
  if (!root) {
    throw new Error('AgenticTeamProjectResponseSchema definition not found');
  }
  return [...flattenObject(root, '', definitions)].sort();
}

function collectObjectDefinitions(source) {
  const definitions = new Map();
  const declaration =
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.\s*object\s*\(/g;
  for (const match of source.matchAll(declaration)) {
    const openParen = source.indexOf('(', match.index);
    const objectStart = source.indexOf('{', openParen);
    if (objectStart < 0) continue;
    const objectEnd = matchingDelimiter(source, objectStart, '{', '}');
    definitions.set(match[1], source.slice(objectStart + 1, objectEnd));
  }
  return definitions;
}

function flattenObject(body, prefix, definitions, active = new Set()) {
  const leaves = new Set();
  for (const property of parseProperties(body)) {
    const path = prefix ? `${prefix}.${property.key}` : property.key;
    const arrayInner = arrayInnerExpression(property.value);
    if (arrayInner !== null) {
      const nestedArray = nestedObjectBody(arrayInner);
      if (nestedArray !== null) {
        for (const leaf of flattenObject(
          nestedArray,
          `${path}[]`,
          definitions,
          active,
        ))
          leaves.add(leaf);
        continue;
      }
      const ref = referenceName(arrayInner);
      const refBody = ref && definitions.get(ref);
      if (refBody && !active.has(ref)) {
        const nextActive = new Set(active);
        nextActive.add(ref);
        for (const leaf of flattenObject(
          refBody,
          `${path}[]`,
          definitions,
          nextActive,
        ))
          leaves.add(leaf);
        continue;
      }
    }

    const nested = nestedObjectBody(property.value);
    if (nested !== null) {
      for (const leaf of flattenObject(nested, path, definitions, active))
        leaves.add(leaf);
      continue;
    }

    const ref = referenceName(property.value);
    const refBody = ref && definitions.get(ref);
    if (refBody && !active.has(ref)) {
      const nextActive = new Set(active);
      nextActive.add(ref);
      for (const leaf of flattenObject(refBody, path, definitions, nextActive))
        leaves.add(leaf);
      continue;
    }
    leaves.add(path);
  }
  return leaves;
}

function parseProperties(body) {
  const properties = [];
  let cursor = 0;
  while (cursor < body.length) {
    cursor = skipWhitespaceAndCommas(body, cursor);
    if (cursor >= body.length) break;
    const keyStart = cursor;
    let key;
    if (body[cursor] === "'" || body[cursor] === '"') {
      const quote = body[cursor++];
      const end = quotedEnd(body, cursor, quote);
      key = body.slice(cursor, end);
      cursor = end + 1;
    } else {
      const match = body.slice(cursor).match(/^[A-Za-z_$][\w$]*/);
      if (!match) {
        cursor++;
        continue;
      }
      key = match[0];
      cursor += key.length;
    }
    cursor = skipSpaces(body, cursor);
    if (body[cursor] !== ':') {
      cursor = keyStart + 1;
      continue;
    }
    cursor++;
    const valueStart = cursor;
    cursor = expressionEnd(body, cursor);
    properties.push({ key, value: body.slice(valueStart, cursor) });
  }
  return properties;
}

function nestedObjectBody(expression) {
  const marker = /z\s*\.\s*object\s*\(/g;
  const match = marker.exec(expression);
  if (!match) return null;
  const objectStart = expression.indexOf('{', match.index + match[0].length);
  if (objectStart < 0) return null;
  const objectEnd = matchingDelimiter(expression, objectStart, '{', '}');
  return expression.slice(objectStart + 1, objectEnd);
}

function arrayInnerExpression(expression) {
  const match = /^\s*z\s*\.\s*array\s*\(/.exec(expression);
  if (!match) return null;
  const open = expression.indexOf('(', match.index);
  const close = matchingDelimiter(expression, open, '(', ')');
  return expression.slice(open + 1, close).trim();
}

function referenceName(expression) {
  const cleaned = expression.replace(/\s+/g, '');
  const direct = cleaned.match(/^([A-Za-z_$][\w$]*)$/);
  if (direct) return direct[1];
  const lazy = cleaned.match(/^z\.lazy\(\(\)=>([A-Za-z_$][\w$]*)\)$/);
  return lazy?.[1] ?? null;
}

function expressionEnd(source, start) {
  let cursor = start;
  const stack = [];
  let quote = null;
  while (cursor < source.length) {
    const char = source[cursor];
    if (quote) {
      if (char === '\\') cursor += 2;
      else if (char === quote) quote = null;
      cursor++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      cursor++;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    else if (char === ')' || char === ']' || char === '}') {
      if (stack.length === 0) return cursor;
      stack.pop();
    } else if (char === ',' && stack.length === 0) {
      return cursor;
    }
    cursor++;
  }
  return cursor;
}

function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let cursor = start; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (quote) {
      if (char === '\\') cursor++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === open) {
      depth++;
    } else if (char === close && --depth === 0) {
      return cursor;
    }
  }
  throw new Error(`Unclosed ${open} delimiter in legacy schema`);
}

function quotedEnd(source, start, quote) {
  for (let cursor = start; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') {
      cursor++;
    } else if (source[cursor] === quote) {
      return cursor;
    }
  }
  return source.length;
}

function skipWhitespaceAndCommas(source, cursor) {
  while (cursor < source.length && /[\s,]/.test(source[cursor])) cursor++;
  return cursor;
}

function skipSpaces(source, cursor) {
  while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
  return cursor;
}
