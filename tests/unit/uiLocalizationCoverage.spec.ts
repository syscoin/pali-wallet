import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import literalExceptions from '../fixtures/ui-localization-literal-exceptions.json';

interface IVisibleLiteral {
  file: string;
  kind: string;
  text: string;
}
interface ILiteralException extends IVisibleLiteral {
  count: number;
  reason: string;
}

const repository = path.resolve(__dirname, '../..');
const roots = ['source/components', 'source/pages'];
const visibleProps = new Set([
  'aria-label',
  'title',
  'placeholder',
  'alt',
  'label',
  'content',
  'progressLabel',
  'message',
]);
const hasWord = new RegExp('\\p{L}', 'u');
const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();
const identity = ({ file, kind, text }: IVisibleLiteral) =>
  JSON.stringify([file, kind, text]);

const isProductionTsx = (file: string) =>
  roots.some((root) => file.startsWith(`${root}/`)) &&
  file.endsWith('.tsx') &&
  !/\.(spec|test)\.tsx$/.test(file) &&
  !file.split('/').some((part) => ['__tests__', '__mocks__'].includes(part));

function productionFiles(directory: string): string[] {
  return fs
    .readdirSync(path.join(repository, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return ['__tests__', '__mocks__'].includes(entry.name)
          ? []
          : productionFiles(file);
      }
      return isProductionTsx(file) ? [file] : [];
    })
    .sort();
}

const directString = (expression?: ts.Expression): string | undefined => {
  while (expression && ts.isParenthesizedExpression(expression))
    expression = expression.expression;
  return expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : undefined;
};

// A bounded AST guard, not general dataflow analysis: it deliberately does not
// translate callback errors, CSS, values, signed content or dynamic metadata.
function visibleLiterals(file: string, source: string): IVisibleLiteral[] {
  const result: IVisibleLiteral[] = [];
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const add = (kind: string, text?: string) => {
    if (text === undefined) return;
    const normalized = normalizeText(text);
    // Pure spacing, punctuation, symbols and numerals are not word-copy.
    if (hasWord.test(normalized)) result.push({ file, kind, text: normalized });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add('jsx-text', node.text);
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(parsed);
      if (visibleProps.has(name)) {
        const initial = node.initializer;
        if (initial && ts.isStringLiteral(initial))
          add(`prop:${name}`, initial.text);
        else if (initial && ts.isJsxExpression(initial))
          add(`prop:${name}`, directString(initial.expression));
      }
    }
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    )
      add('jsx-expression', directString(node.expression));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

function coverageIssues(
  actual: IVisibleLiteral[],
  exceptions: ILiteralException[]
): string[] {
  const counts = new Map<string, number>();
  for (const literal of actual) {
    const key = identity(literal);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const issues: string[] = [];
  const allowed = new Set<string>();
  for (const exception of exceptions) {
    const key = identity(exception);
    if (allowed.has(key)) issues.push(`Duplicate exception: ${key}`);
    allowed.add(key);
    if (
      !isProductionTsx(exception.file) ||
      ![
        'jsx-text',
        'jsx-expression',
        ...[...visibleProps].map((p) => `prop:${p}`),
      ].includes(exception.kind) ||
      !exception.text ||
      normalizeText(exception.text) !== exception.text ||
      !Number.isSafeInteger(exception.count) ||
      exception.count < 1 ||
      !exception.reason ||
      exception.reason.trim().length < 25
    )
      issues.push(`Invalid exact exception: ${key}`);
    const observed = counts.get(key) || 0;
    if (observed !== exception.count)
      issues.push(
        `Exception count mismatch: ${key}; expected ${exception.count}, observed ${observed}`
      );
  }
  for (const [key, count] of counts)
    if (!allowed.has(key))
      issues.push(`Unaudited visible literal: ${key}; observed ${count}`);
  return issues;
}

it('requires an exact reviewed disposition for production JSX word-copy and direct visible string props', () => {
  const files = roots.flatMap(productionFiles);
  for (const root of roots)
    expect(files.some((file) => file.startsWith(`${root}/`))).toBe(true);
  const actual = files.flatMap((file) =>
    visibleLiterals(file, fs.readFileSync(path.join(repository, file), 'utf8'))
  );
  expect(coverageIssues(actual, literalExceptions.exceptions)).toEqual([]);
});

it('detects JSX text, fragment expressions and every specified visible prop without reading internal attributes', () => {
  const file = 'source/components/Fixture.tsx';
  const source = [
    '<><p>Visible guidance</p>{"Expression guidance"}{`Template guidance`}',
    '{("Parenthesized guidance")}',
    '<Thing aria-label="Accessible action" title={"Visible title"}',
    'placeholder={`Visible placeholder`} alt="Image description"',
    'label="Field label" content="Tooltip guidance"',
    'progressLabel="Progress guidance" message="Status guidance"',
    'className="not UI copy" value="signed raw payload"',
    'data-message="metadata" id="internal identifier" href="https://example.test" />',
    '{t("existing.key")} {rawMetadata} {/* Comment guidance */}',
    '<p>123 — + %</p></>',
  ].join('\n');
  const actual = visibleLiterals(file, source);
  expect(actual).toEqual([
    { file, kind: 'jsx-text', text: 'Visible guidance' },
    { file, kind: 'jsx-expression', text: 'Expression guidance' },
    { file, kind: 'jsx-expression', text: 'Template guidance' },
    { file, kind: 'jsx-expression', text: 'Parenthesized guidance' },
    { file, kind: 'prop:aria-label', text: 'Accessible action' },
    { file, kind: 'prop:title', text: 'Visible title' },
    { file, kind: 'prop:placeholder', text: 'Visible placeholder' },
    { file, kind: 'prop:alt', text: 'Image description' },
    { file, kind: 'prop:label', text: 'Field label' },
    { file, kind: 'prop:content', text: 'Tooltip guidance' },
    { file, kind: 'prop:progressLabel', text: 'Progress guidance' },
    { file, kind: 'prop:message', text: 'Status guidance' },
  ]);
});

it('does not exempt changed, additional, moved or no-longer-present occurrences', () => {
  const brand = {
    file: 'source/components/Brand.tsx',
    kind: 'jsx-text',
    text: 'Pali',
  };
  const exception = {
    ...brand,
    count: 1,
    reason: 'Exact existing Pali product wordmark, not ordinary guidance.',
  };
  expect(coverageIssues([brand], [exception])).toEqual([]);
  expect(coverageIssues([], [exception])).toEqual([
    expect.stringContaining('observed 0'),
  ]);
  expect(coverageIssues([brand, brand], [exception])).toEqual([
    expect.stringContaining('observed 2'),
  ]);
  for (const changed of [
    { ...brand, text: 'New English guidance' },
    { ...brand, file: 'source/pages/Another.tsx' },
    { ...brand, kind: 'prop:title' },
  ]) {
    expect(coverageIssues([changed], [exception])).toEqual([
      expect.stringContaining('observed 0'),
      expect.stringContaining('Unaudited visible literal'),
    ]);
  }
  expect(coverageIssues([brand], [exception, exception])).toEqual([
    expect.stringContaining('Duplicate exception'),
  ]);
  expect(coverageIssues([brand], [{ ...exception, reason: '' }])).toEqual([
    expect.stringContaining('Invalid exact exception'),
  ]);
});

it('covers both production roots without treating native/e2e mocks as production', () => {
  expect(isProductionTsx('source/components/Actual.tsx')).toBe(true);
  expect(isProductionTsx('source/pages/Actual.tsx')).toBe(true);
  for (const file of [
    'source/components/Actual.spec.tsx',
    'source/pages/Actual.test.tsx',
    'source/pages/__tests__/Actual.tsx',
    'source/components/__mocks__/Actual.tsx',
    'tests/unit/Actual.tsx',
    'e2e/Actual.tsx',
    'source/utils/Actual.tsx',
    'source/pages/notTsx.ts',
  ])
    expect(isProductionTsx(file)).toBe(false);
});
