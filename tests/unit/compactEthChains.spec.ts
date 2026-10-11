import fs from 'fs';

import compactEthChains from '../../source/config/loaders/compactEthChains';

const vendorPath = require.resolve('eth-chains/dist/src/chains.js');
const vendorSource = fs.readFileSync(vendorPath, 'utf8');
const vendorModule = jest.requireActual('eth-chains/dist/src/chains.js');

function executeGenerated(source: string, exports: any = {}): any {
  // Only evaluate the generated loader output and locally authored fixtures.
  new Function('exports', source)(exports);
  return exports;
}

function expectExactGraph(
  original: any,
  emitted: any,
  originalReferences = new Map<object, object>(),
  emittedReferences = new Set<object>()
): void {
  if (original === null || typeof original !== 'object') {
    expect(emitted).toBe(original);
    return;
  }
  if (originalReferences.has(original)) {
    expect(emitted).toBe(originalReferences.get(original));
    return;
  }
  expect(emitted).not.toBe(original);
  expect(emitted).not.toBeNull();
  expect(typeof emitted).toBe('object');
  expect(emittedReferences.has(emitted)).toBe(false);
  originalReferences.set(original, emitted);
  emittedReferences.add(emitted);
  expect(Object.getPrototypeOf(emitted)).toBe(Object.getPrototypeOf(original));
  expect(Reflect.ownKeys(emitted)).toEqual(Reflect.ownKeys(original));
  expect(Object.isExtensible(emitted)).toBe(Object.isExtensible(original));
  expect(Object.isSealed(emitted)).toBe(Object.isSealed(original));
  expect(Object.isFrozen(emitted)).toBe(Object.isFrozen(original));
  for (const key of Reflect.ownKeys(original)) {
    const expected = Object.getOwnPropertyDescriptor(original, key)!;
    const actual = Object.getOwnPropertyDescriptor(emitted, key)!;
    expect({ ...actual, value: undefined }).toEqual({
      ...expected,
      value: undefined,
    });
    expectExactGraph(
      expected.value,
      actual.value,
      originalReferences,
      emittedReferences
    );
  }
}

const fixture = (literal: string) =>
  '"use strict";Object.defineProperty(exports,"__esModule",{value:true});' +
  'exports.chains=void 0;exports.chains=' +
  literal +
  ';';

it('preserves all 440 vendor chains and the entire export/object identity graph', () => {
  // Execute the original literal module in the same fixture realm: Jest may
  // allocate requireActual's CommonJS exports in a different VM realm.
  const original = executeGenerated(vendorSource);
  const emitted = executeGenerated(compactEthChains(vendorSource));
  expect(Object.keys(emitted.chains)).toHaveLength(440);
  expect(JSON.stringify(emitted)).toBe(JSON.stringify(vendorModule));
  expectExactGraph(original, emitted);
  for (const id of Object.keys(vendorModule.chains)) {
    expect(emitted.chains[id]).toEqual(vendorModule.chains[id]);
  }
});

it('retains ordinary mutable arrays and objects with independent module allocations', () => {
  const generated = compactEthChains(vendorSource);
  const first = executeGenerated(generated);
  const second = executeGenerated(generated);
  expectExactGraph(first, second);
  first.chains[1].rpc[0] = 'changed';
  first.chains[1].nativeCurrency.symbol = 'changed';
  first.chains[1].newProperty = 'changed';
  first.chains[1].rpc.push('changed');
  first.chains[1].faucets.push('changed');
  delete first.chains[2];
  expect(second).toEqual(vendorModule);
  expect(executeGenerated(generated)).toEqual(vendorModule);
});

it.each([null, Object.prototype, { inherited: true }])(
  'preserves the caller-provided CommonJS export object and its prototype',
  (prototype) => {
    const expectedExports = Object.create(prototype);
    const actualExports = Object.create(prototype);
    const original = executeGenerated(vendorSource, expectedExports);
    const emitted = executeGenerated(
      compactEthChains(vendorSource),
      actualExports
    );
    expect(original).toBe(expectedExports);
    expect(emitted).toBe(actualExports);
    expect(Object.getPrototypeOf(emitted)).toBe(prototype);
    expectExactGraph(original, emitted);
  }
);

it('preserves escaped strings, computed prototype-looking keys and duplicate-key order', () => {
  const escaped =
    'quotes " \\ newline\n tab\t Unicode 😀 lone surrogate \ud800';
  const record = JSON.stringify({
    ['__proto__']: { value: escaped },
    constructor: [escaped],
    [escaped]: escaped,
    nested: [{ field: escaped }],
    negative: -7,
    nil: null,
  }).replace('"__proto__":', '["__proto__"]:');
  const source = fixture(
    `{3:${record},1:${record},2:${record},duplicate:1,last:2,duplicate:3}`
  );
  const original = executeGenerated(source);
  const emitted = executeGenerated(compactEthChains(source));
  expectExactGraph(original, emitted);
  expect(Object.hasOwn(emitted.chains[1], '__proto__')).toBe(true);
  expect('value' in emitted.chains[1]).toBe(false);
  emitted.chains[1].__proto__.value = 'changed';
  emitted.chains[1].constructor.push('changed');
  expect(emitted.chains[2]).toEqual(original.chains[2]);
  expect(emitted.chains[3]).toEqual(original.chains[3]);
});

it.each([
  vendorSource + '\nglobalThis.sideEffect = true;',
  vendorSource.replace('exports.chains = void 0;', ''),
  vendorSource.replace('exports.chains = void 0;', 'exports.other = void 0;'),
  vendorSource.replace('{ value: true }', '{ value: true, writable: true }'),
  fixture('{...other}'),
  fixture('{get secret(){return 1;}}'),
  fixture('{name:callback()}'),
  fixture('{record:sharedReference}'),
  fixture('{number:-0}'),
  fixture('{number:Infinity}'),
  fixture('{number:NaN}'),
  fixture('{values:[1,,3]}'),
  fixture('{__proto__:{value:1}}'),
  fixture('{computed:["not"+"static"]}'),
  fixture('{broken:}'),
])(
  'fails compilation for code, aliases or an unexpected vendor export shape',
  (source) => {
    expect(() => compactEthChains(source)).toThrow(
      'Unexpected eth-chains static module shape'
    );
  }
);

it('does not emit vendor calls, requires, evaluators or compressed runtime decoding', () => {
  const generated = compactEthChains(vendorSource);
  expect(generated).not.toMatch(/\b(?:eval|Function|require)\s*\(/);
  expect(generated).not.toMatch(/\bJSON\.parse\s*\(/);
  expect(generated.length).toBeLessThan(vendorSource.length);
});
