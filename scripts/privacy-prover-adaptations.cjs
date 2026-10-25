// Build-time adaptations of SHA-256-pinned Classic sources. Never loaded by the wallet.
const { parseSync } = require('@babel/core');

function visit(node, parent, apply) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') apply(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value))
      value.forEach((child) => visit(child, node, apply));
    else if (value && typeof value.type === 'string') visit(value, node, apply);
  }
}

function suspendSignalWrites(source, generator = true) {
  const ast = parseSync(`(${source})`, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
  });
  const root = ast.program.body[0].expression;
  if (root.type !== 'FunctionExpression' || root.async || root.generator)
    throw Error('Unsupported witness function');
  const offsets = [];
  visit(root, undefined, (node, parent) => {
    if (node !== root && /Function/.test(node.type))
      throw Error('Nested witness function');
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'MemberExpression' ||
      node.callee.computed ||
      node.callee.object.type !== 'Identifier' ||
      node.callee.object.name !== 'ctx' ||
      !['setPin', 'setSignal'].includes(node.callee.property.name)
    )
      return;
    if (
      !generator ||
      parent.type !== 'ExpressionStatement' ||
      parent.expression !== node
    )
      throw Error(
        'Witness signal write must be a standalone template statement'
      );
    offsets.push(node.start - 1); // Parse-only parentheses are not in the original source.
  });
  if (!generator) return source;
  for (const offset of offsets.sort((a, b) => b - a))
    source = source.slice(0, offset) + 'yield ' + source.slice(offset);
  if (!/^function\s*\(/.test(source))
    throw Error('Unsupported witness template');
  return source.replace(/^function/, 'function*');
}

function replaceOnce(source, previous, next) {
  if (source.split(previous).length !== 2)
    throw Error('Pinned witness interpreter adaptation no longer matches');
  return source.replace(previous, next);
}

function trampolineWitnessRuntime(source) {
  source = replaceOnce(
    source,
    'const bigInt = require("./bigint");',
    '// Local adaptation: generator templates and explicit depth-first frames avoid\n' +
      '// recursive component execution. See LICENSES.md and the pinned generator.\n' +
      'const bigInt = require("./bigint");'
  );
  source = replaceOnce(
    source,
    '        this.notInitSignals = {};',
    '        this.notInitSignals = {};\n        this.componentFrames = [];\n        this.drainingComponents = false;'
  );
  const start = source.indexOf('    triggerComponent(c) {');
  const end = source.indexOf('    callFunction(functionName, params) {', start);
  if (start === -1 || end === -1)
    throw Error('Pinned component interpreter missing');
  source =
    source.slice(0, start) +
    `    triggerComponent(c) {
        this.componentFrames.push({ candidate: c });
        this.drainComponents();
    }

    drainComponents() {
        if (this.drainingComponents) return;
        this.drainingComponents = true;
        const initialComponent = this.currentComponent;
        const initialScopes = this.scopes;
        try {
            while (this.componentFrames.length) {
                const frame = this.componentFrames[this.componentFrames.length - 1];
                if (!frame.iterator) {
                    this.componentFrames.pop();
                    const c = frame.candidate;
                    // Check when execution begins: an earlier depth-first child
                    // may already have consumed a duplicate trigger candidate.
                    if (this.notInitSignals[c] != 0) continue;
                    this.notInitSignals[c] --;
                    const component = this.circuit.components[c];
                    if (this.options.logTrigger) this.options.logFunction("Component Treiggered: " + component.name);
                    const oldComponent = this.currentComponent;
                    const oldScopes = this.scopes;
                    this.currentComponent = component.name;
                    const newScope = {};
                    for (let p in component.params) newScope[p] = component.params[p];
                    this.scopes = [ oldScopes[0], newScope ];
                    this.componentFrames.push({
                        component,
                        oldComponent,
                        oldScopes,
                        iterator: this.circuit.templates[component.template](this)
                    });
                } else if (frame.iterator.next().done) {
                    if (this.componentFrames.pop() !== frame) throw new Error("Unexpected witness frame");
                    this.scopes = frame.oldScopes;
                    this.currentComponent = frame.oldComponent;
                    if (this.options.logTrigger) this.options.logFunction("End Component Treiggered: " + frame.component.name);
                }
            }
        } finally {
            this.componentFrames.length = 0;
            this.scopes = initialScopes;
            this.currentComponent = initialComponent;
            this.drainingComponents = false;
        }
    }

` +
    source.slice(end);
  source = replaceOnce(
    source,
    `        callComponents.map( (c) => {
            if (this.notInitSignals[c] == 0) this.triggerComponent(c);
        });`,
    `        // Stack candidates in reverse so the original listed order drains
        // depth-first before the suspended template resumes after this write.
        for (let i=callComponents.length-1; i>=0; i--) {
            this.componentFrames.push({ candidate: callComponents[i] });
        }
        this.drainComponents();`
  );
  return source;
}

module.exports = { suspendSignalWrites, trampolineWitnessRuntime };
