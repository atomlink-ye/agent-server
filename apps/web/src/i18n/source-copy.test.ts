import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      return ['test-support', '__screenshots__'].includes(entry.name)
        ? []
        : sources(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

function untranslatedCopy(text: string): string[] {
  const source = ts.createSourceFile(
    'component.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const value = node.text;
      // Symbolic units/identifiers are not English prose. Interpolated phrases
      // and single-word JSX labels are inspected without requiring a space.
      let attribute: ts.JsxAttribute | undefined;
      let withinJsx = false;
      let ancestor: ts.Node | undefined = node.parent;
      while (ancestor) {
        if (ts.isJsxExpression(ancestor)) withinJsx = true;
        if (ts.isJsxAttribute(ancestor)) {
          attribute = ancestor;
          break;
        }
        ancestor = ancestor.parent;
      }
      const visibleAttribute =
        attribute &&
        [
          'title',
          'aria-label',
          'aria-description',
          'placeholder',
          'alt',
          'label',
          'section',
          'description',
          'emptyLabel',
          'heading',
          'hint',
        ].includes(attribute.name.getText(source));
      const prose = /[A-Za-z]{2,}[ '’]+[A-Za-z]{2,}/u.test(value);
      const directLabel =
        (ts.isJsxText(node) || visibleAttribute) && /[A-Za-z]{2,}/u.test(value);
      const authoredLabel =
        ts.isPropertyAssignment(node.parent) &&
        ['role', 'instructions'].includes(node.parent.name.getText(source)) &&
        /[A-Za-z]{2,}/u.test(value) &&
        !['primary', 'lead', 'member'].includes(value);
      // Closed role tokens above are source data, localized at display time.
      const fragment =
        (ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        /(?:^|\s)[A-Za-z]{2,}(?:\s|$)/u.test(value) &&
        !['UTC', 'ms'].includes(value.trim());
      const childValue =
        withinJsx &&
        (ts.isJsxExpression(node.parent) ||
          ts.isConditionalExpression(node.parent)) &&
        /[A-Za-z]{2,}/u.test(value) &&
        ![
          'true',
          'false',
          'alert',
          'status',
          'page',
          'text',
          'number',
          'current-password',
          'new-password',
        ].includes(value);
      const parent = node.parent;
      const key =
        ts.isCallExpression(parent) &&
        parent.arguments[0] === node &&
        parent.expression.getText(source) === 't';
      const comparison =
        ts.isBinaryExpression(parent) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(parent.operatorToken.kind);
      const internalError =
        ts.isNewExpression(parent) &&
        parent.expression.getText(source).endsWith('Error');
      const technicalAttribute = attribute && !visibleAttribute;
      if (
        (prose || directLabel || authoredLabel || fragment || childValue) &&
        !key &&
        !comparison &&
        !internalError &&
        !technicalAttribute &&
        !/^[a-z][\w]*(?:\.[\w]+)+$/u.test(value.trim())
      ) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${line}: ${JSON.stringify(value)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

it('detects known JSX text, templates, accessibility labels, and editable defaults', () => {
  expect(untranslatedCopy('<p>Hello</p>')).toHaveLength(1);
  expect(untranslatedCopy('<TitleBar section="Tasks" />')).toHaveLength(1);
  expect(untranslatedCopy("<p>{format('Hello world')}</p>")).toHaveLength(1);
  expect(untranslatedCopy('<p>{`${count} comments`}</p>')).toHaveLength(1);
  expect(untranslatedCopy('<p title="Details" />')).toHaveLength(1);
  expect(untranslatedCopy("const draft = {role: 'Reviewer'};")).toHaveLength(1);
  expect(
    untranslatedCopy('<p className="some class">{t("work.title")}</p>'),
  ).toEqual([]);
});

it('keeps English display prose out of component source, including template fragments', () => {
  const files = sources(root);
  expect(
    files.some((file) =>
      file.endsWith('/features/work/components/work-header.tsx'),
    ),
  ).toBe(true);
  const violations = files.flatMap((file) =>
    untranslatedCopy(readFileSync(file, 'utf8')).map(
      (entry) => `${relative(root, file)}:${entry}`,
    ),
  );
  expect(violations).toEqual([]);
});

it.each(['en.ts', 'zh-CN.ts'])(
  'declares every key exactly once in %s',
  (name) => {
    const path = resolve(root, 'i18n', name);
    const source = ts.createSourceFile(
      name,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const keys: string[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name))
        keys.push(node.name.text);
      ts.forEachChild(node, walk);
    };
    walk(source);
    expect(keys).toContain('work.latestState');
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual(
      [],
    );
  },
);
