/* eslint-disable @typescript-eslint/no-var-requires */
const ts = require('typescript');

const compactAbiJson = require('./compactAbiJson');

const unexpected = () => {
  throw new Error('Unexpected eth-chains static module shape');
};

// Read static JSON-compatible literals only. No source execution, identifiers,
// spreads, getters or calls can become data or disappear from the module.
function readLiteral(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(node)) {
    const number = Number(node.text);
    if (!Number.isFinite(number)) unexpected();
    return number;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    const number = -readLiteral(node.operand);
    // The reused JSON representation cannot retain negative zero. Fail closed
    // if a future vendor release introduces it instead of changing its value.
    if (Object.is(number, -0)) unexpected();
    return number;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(readLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) unexpected();
      const computed = ts.isComputedPropertyName(property.name);
      const key = computed
        ? readLiteral(property.name.expression)
        : ts.isIdentifier(property.name)
        ? property.name.text
        : readLiteral(property.name);
      if (
        (typeof key !== 'string' && typeof key !== 'number') ||
        (!computed && key === '__proto__')
      )
        unexpected();
      // Define ordinary own data properties, including computed __proto__,
      // rather than invoking Object.prototype setters.
      Object.defineProperty(value, key, {
        value: readLiteral(property.initializer),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return value;
  }
  return unexpected();
}

const isAccess = (node, owner, field) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === owner &&
  node.name.text === field;

const isAssignment = (node) =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  isAccess(node.left, 'exports', 'chains');

module.exports = function compactEthChains(source) {
  const file = ts.createSourceFile(
    'eth-chains.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (file.parseDiagnostics.length || file.statements.length !== 4)
    unexpected();
  if (!file.statements.every(ts.isExpressionStatement)) unexpected();
  const [strict, descriptor, initialize, assignment] = file.statements.map(
    (statement) => statement.expression
  );
  if (!ts.isStringLiteral(strict) || strict.text !== 'use strict') unexpected();
  if (
    !ts.isCallExpression(descriptor) ||
    !isAccess(descriptor.expression, 'Object', 'defineProperty') ||
    descriptor.arguments.length !== 3 ||
    !ts.isIdentifier(descriptor.arguments[0]) ||
    descriptor.arguments[0].text !== 'exports' ||
    readLiteral(descriptor.arguments[1]) !== '__esModule' ||
    JSON.stringify(readLiteral(descriptor.arguments[2])) !== '{"value":true}' ||
    !isAssignment(initialize) ||
    !ts.isVoidExpression(initialize.right) ||
    !ts.isNumericLiteral(initialize.right.expression) ||
    Number(initialize.right.expression.text) !== 0 ||
    !isAssignment(assignment) ||
    !ts.isObjectLiteralExpression(assignment.right)
  )
    unexpected();

  const chains = readLiteral(assignment.right);
  const generated = compactAbiJson(JSON.stringify([chains]));
  // Preserve the named CommonJS export and descriptor insertion order. The
  // existing pure shape/string-pool helper creates every object and array anew.
  return (
    '"use strict";Object.defineProperty(exports,"__esModule",{value:true});' +
    'exports.chains=void 0;exports.chains=(function(module){' +
    generated +
    'return module.exports[0];})({});'
  );
};
