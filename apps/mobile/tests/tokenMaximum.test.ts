import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
  formatTokenUnits,
  parseTokenAmount,
} from '../../../source/shared/erc20.ts';
import { sameNativePortfolioAccount } from '../src/portfolio/nativePortfolio.ts';
import type { NativeTokenSnapshot } from '../src/portfolio/nativeTokens.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

const owner = {
  address: '0x1111111111111111111111111111111111111111',
  network: 'ethereum',
  revision: 5,
};
const token = {
  contractAddress: '0x2222222222222222222222222222222222222222',
  decimals: 255,
  symbol: 'T',
  name: 'Token',
};
function fixture(units: string | null, precision = 255) {
  const selected = { ...token, decimals: precision };
  let snapshot: NativeTokenSnapshot = {
    account: owner,
    status: 'ready',
    items: [{ metadata: selected, status: 'available', units, updatedAt: 1 }],
    preview: null,
    previewStatus: 'idle',
    discovery: null,
    busy: false,
    error: null,
  };
  const values: string[] = [];
  const reference = { current: null as unknown };
  let cleanup = () => {};
  const react = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    useRef: () => reference,
    useLayoutEffect(callback: () => () => void) {
      cleanup();
      cleanup = callback();
    },
  };
  const imports: Record<string, unknown> = {
    react,
    '../portfolio/nativePortfolio': { sameNativePortfolioAccount },
    '../../../../source/shared/erc20': { formatTokenUnits },
    '../ui': { Button: 'Button' },
    '../platform/localization': nativeTranslationFixture,
  };
  const module = {
    exports: {} as {
      NativeTokenMaximum: (props: object) => {
        type: unknown;
        props: { disabled: boolean; onPress(): void };
      };
    },
  };
  const source = readFileSync(
    new NodeURL('../src/screens/NativeTokenMaximum.tsx', import.meta.url),
    'utf8'
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(name: string) {
        assert(name in imports, name);
        return imports[name];
      },
    }
  );
  return {
    values,
    selected,
    render(disabled = false) {
      return module.exports.NativeTokenMaximum({
        token: selected,
        owner,
        snapshot,
        view: { getSnapshot: () => snapshot },
        selected: false,
        disabled,
        onSelect: (value: string) => values.push(value),
      });
    },
    change(update: Partial<NativeTokenSnapshot>) {
      snapshot = { ...snapshot, ...update };
    },
    setUnits(
      value: string | null,
      status: 'available' | 'loading' | 'error' = 'available'
    ) {
      snapshot = {
        ...snapshot,
        items: [{ metadata: selected, status, units: value, updatedAt: 1 }],
      };
    },
    dispose() {
      cleanup();
    },
  };
}
for (const [decimals, units] of [
  [0, '9'],
  [255, '1'],
  [255, ((1n << 256n) - 1n).toString()],
] as const)
  test(`token MAX round trips exact units with ${decimals} decimals and ${units.length} digits`, () => {
    const f = fixture(units, decimals);
    const button = f.render();
    assert.equal(button.props.disabled, false);
    button.props.onPress();
    assert.equal(parseTokenAmount(f.values[0], decimals), units);
    f.dispose();
  });
for (const [units, status] of [
  ['0', 'available'],
  [null, 'available'],
  [null, 'loading'],
  [null, 'error'],
] as const)
  test(`token MAX refuses ${status} balance ${units}`, () => {
    const f = fixture('1');
    f.setUnits(units, status);
    const button = f.render();
    assert.equal(button.props.disabled, true);
    button.props.onPress();
    assert.deepEqual(f.values, []);
    f.dispose();
  });
for (const change of [
  { address: '0x3333333333333333333333333333333333333333' },
  { network: 'syscoin-nevm' },
  { revision: 6 },
])
  test(`same-token MAX refuses a different owner scope ${
    Object.keys(change)[0]
  }`, () => {
    const f = fixture('1');
    const previous = f.render();
    f.change({ account: { ...owner, ...change } });
    previous.props.onPress();
    const current = f.render();
    assert.equal(current.props.disabled, true);
    current.props.onPress();
    assert.deepEqual(f.values, []);
    f.dispose();
  });
test('MAX callbacks from an unmounted or superseded render cannot edit an amount', () => {
  const f = fixture('1');
  const old = f.render();
  f.render(true);
  old.props.onPress();
  assert.deepEqual(f.values, []);
  const mounted = f.render();
  f.dispose();
  mounted.props.onPress();
  assert.deepEqual(f.values, []);
});
