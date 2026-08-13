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
    if (character === '`') {
      index = scanTemplate(text, index, result);
      continue;
    }
    if (character === "'" || character === '"') {
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

function scanTemplate(text, start, result) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '`') return index + 1;
    if (text.startsWith('${', index)) {
      const expressionEnd = findExpressionEnd(text, index + 2, result);
      result.push(
        ...executableIdentifiers(text.slice(index + 2, expressionEnd)),
      );
      index = expressionEnd + 1;
      continue;
    }
    index++;
  }
  return text.length;
}

function findExpressionEnd(text, start, result) {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      index = skipUntil(text, index + 2, '\n');
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipUntil(text, index + 2, '*/');
      continue;
    }
    if (text[index] === "'" || text[index] === '"') {
      index = skipString(text, index, text[index]);
      continue;
    }
    if (text[index] === '`') {
      index = scanTemplate(text, index, result);
      continue;
    }
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return index;
    index++;
  }
  return text.length;
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
