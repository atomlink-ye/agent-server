#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = 'src/bootstrap.ts';
const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const forbiddenIdentifiers = [
  'workIdentity',
  'startWorkRun',
  'createPostgresWorkIdentityModule',
  'createProductProjection',
];
const identifiers = executableIdentifiers(source);
const violations = forbiddenIdentifiers.filter((name) =>
  identifiers.includes(name),
);
if (violations.length) {
  for (const marker of violations)
    console.error(
      `work_bootstrap_boundary_violation:file=${file}:identifier=${marker}`,
    );
  process.exit(1);
}
console.log(
  JSON.stringify({
    guard: 'work-bootstrap-zero',
    file,
    predicate: forbiddenIdentifiers.join('|'),
    ignored_syntax: ['comments', 'string-literals'],
    violations: 0,
  }),
);

function executableIdentifiers(text) {
  const result = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      index = skipUntil(text, index + 2, '\n');
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipUntil(text, index + 2, '*/');
      continue;
    }
    const character = text[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipString(text, index, character);
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index++;
      while (index < text.length && /[A-Za-z0-9_$]/.test(text[index])) index++;
      const token = text.slice(start, index);
      result.push(token);
      continue;
    }
    index++;
  }
  return result;
}

function skipUntil(text, start, terminator) {
  const end = text.indexOf(terminator, start);
  return end < 0 ? text.length : end + terminator.length;
}

function skipString(text, start, quote) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') index += 2;
    else if (text[index] === quote) return index + 1;
    else index++;
  }
  return text.length;
}
