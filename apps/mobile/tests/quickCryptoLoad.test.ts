import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { loadQuickCrypto } from '../src/crypto/quickCryptoLoad.ts';
import type { CryptoLoadDiagnostic } from '../src/crypto/diagnostics.ts';
import type { MetroErrorUtils } from '../src/crypto/quickCryptoLoad.ts';

type Handler = ReturnType<MetroErrorUtils['getGlobalHandler']>;

function metroFixture() {
  const forwarded: unknown[] = [];
  const original: Handler = (error) => { forwarded.push(error); };
  let handler = original;
  const errorUtils = {
    getGlobalHandler: () => handler,
    setGlobalHandler: (next: Handler) => { handler = next; },
    reportFatalError: (error: unknown) => { handler(error, true); },
  };
  const runtime: Record<string, unknown> = { ErrorUtils: errorUtils };
  const context = createContext({ global: runtime, __DEV__: false, __METRO_GLOBAL_PREFIX__: '' });
  const source = readFileSync(new NodeURL('../node_modules/metro-runtime/src/polyfills/require.js', import.meta.url), 'utf8');
  runInContext(source, context);
  let nextId = 1;
  return {
    original, errorUtils, forwarded,
    inGuard: () => runInContext('inGuard', context) as boolean,
    defineFailure(error: unknown) {
      const id = nextId++;
      runtime[`failure${id}`] = error;
      runInContext(`global.__d(function () { throw global.failure${id}; }, ${id}, []);`, context);
      return () => (runtime.__r as (id: number) => unknown)(id);
    },
  };
}

test('the installed Metro loader swallows a module error while the scoped loader recovers its original identity', () => {
  const fixture = metroFixture();
  const original = new Error('QuickBase64 synthetic module failure');
  assert.equal(fixture.defineFailure(original)(), undefined);
  assert.deepEqual(fixture.forwarded, [original]);
  assert.equal(fixture.inGuard(), false);

  const captured = new Error('NitroModules synthetic initialization failure');
  let diagnostic: CryptoLoadDiagnostic | undefined;
  assert.throws(() => loadQuickCrypto(fixture.defineFailure(captured), (value) => {
    diagnostic = value;
  }, fixture.errorUtils), (error) => error === captured);
  assert.equal(diagnostic?.markers.nitroModules, true);
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
  assert.deepEqual(fixture.forwarded, [original]);
  assert.equal(fixture.inGuard(), false);

  // A second module must still enter Metro's guard and reach the restored handler.
  const later = Error('unrelated later module failure');
  assert.equal(fixture.defineFailure(later)(), undefined);
  assert.deepEqual(fixture.forwarded, [original, later]);
  assert.equal(fixture.inGuard(), false);
});

test('a successful scoped load returns its exact value and restores the handler before returning', () => {
  const fixture = metroFixture();
  const value = { install() {} };
  let diagnostics = 0;
  assert.equal(loadQuickCrypto(() => value, () => { diagnostics++; }, fixture.errorUtils), value);
  assert.equal(diagnostics, 0);
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
});

test('direct errors and observer errors preserve the first load error and restore before observation', () => {
  const fixture = metroFixture();
  const original = new TypeError('synthetic original');
  assert.throws(() => loadQuickCrypto(() => { throw original; }, () => {
    assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
    assert.equal(loadQuickCrypto(() => 'reentrant observation', () => {}, fixture.errorUtils), 'reentrant observation');
    throw new Error('observer cannot replace original');
  }, fixture.errorUtils), (error) => error === original);
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
});

test('nested scoped loads restore their enclosing handler and preserve their own failures', () => {
  const fixture = metroFixture();
  const inner = new Error('QuickCrypto nested failure');
  const diagnostics: CryptoLoadDiagnostic[] = [];
  assert.throws(() => loadQuickCrypto(() => {
    const enclosing = fixture.errorUtils.getGlobalHandler();
    assert.throws(() => loadQuickCrypto(fixture.defineFailure(inner), (value) => {
      diagnostics.push(value);
    }, fixture.errorUtils), (error) => error === inner);
    assert.equal(fixture.errorUtils.getGlobalHandler(), enclosing);
    fixture.errorUtils.reportFatalError(inner);
  }, (value) => { diagnostics.push(value); }, fixture.errorUtils), (error) => error === inner);
  assert.equal(diagnostics.length, 2);
  assert(diagnostics.every((value) => value.markers.quickCrypto));
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
  assert.equal(fixture.inGuard(), false);
});

test('multiple captured or direct errors cannot replace the first synchronous load failure', () => {
  const fixture = metroFixture();
  const first = new Error('first original failure');
  const second = new Error('later failure');
  let observations = 0;
  assert.throws(() => loadQuickCrypto(() => {
    fixture.errorUtils.reportFatalError(first);
    fixture.errorUtils.reportFatalError(second);
    throw second;
  }, () => { observations++; }, fixture.errorUtils), (error) => error === first);
  assert.equal(observations, 1);
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
});

test('an unavailable Metro error guard fails before invoking the module loader', () => {
  let loads = 0;
  for (const guard of [undefined, {}, { getGlobalHandler() { return null; }, setGlobalHandler() {} }]) {
    assert.throws(() => loadQuickCrypto(() => { loads++; return {}; }, () => {}, guard as MetroErrorUtils | undefined), /NATIVE_CRYPTO_LOAD_GUARD_UNAVAILABLE/);
  }
  assert.equal(loads, 0);
});

test('a handler restoration error cannot replace a prior load failure or permit a successful return', () => {
  const original = new Error('original load failure');
  const restoration = new Error('handler restoration failed');
  const previous: Handler = () => {};
  const guard = {
    getGlobalHandler: () => previous,
    setGlobalHandler(handler: Handler) { if (handler === previous) throw restoration; },
  };
  assert.throws(() => loadQuickCrypto(() => { throw original; }, () => {}, guard), (error) => error === original);
  assert.throws(() => loadQuickCrypto(() => 'success', () => {}, guard), (error) => error === restoration);
});

test('a retained capture forwards later unrelated errors to the prior handler if restoration throws', () => {
  const original = new Error('original load failure');
  const restoration = new Error('handler restoration failed');
  const unrelated = new Error('later unrelated failure');
  const forwarded: { error: unknown; isFatal?: boolean }[] = [];
  const previous: Handler = (error, isFatal) => { forwarded.push({ error, isFatal }); };
  let installed = previous;
  const guard = {
    getGlobalHandler: () => installed,
    setGlobalHandler(handler: Handler) {
      if (handler === previous) throw restoration;
      installed = handler;
    },
  };
  assert.throws(() => loadQuickCrypto(() => {
    installed(original, true);
  }, () => {}, guard), (error) => error === original);
  assert.deepEqual(forwarded, []);
  installed(unrelated, false);
  assert.deepEqual(forwarded, [{ error: unrelated, isFatal: false }]);
});

test('a swallowed native dependency failure keeps bootstrap terminal before provider creation or installation', async () => {
  const fixture = metroFixture();
  const original = new Error('QuickBase64 synthetic native dependency failure');
  const load = fixture.defineFailure(original);
  const source = readFileSync(new NodeURL('../src/platform/cryptoBootstrap.native.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exported: Record<string, (...args: unknown[]) => unknown> = {};
  const existingCrypto = {};
  let providers = 0, installs = 0, qualifications = 0, loads = 0;
  const context = {
    exports: exported, crypto: existingCrypto,
    require(name: string) {
      if (name === 'expo') return {};
      if (name === './processCompatibility.ts') return { ensureNativeProcessCompatibility() {} };
      if (name === '../crypto/quickCryptoLoad.ts') return { loadQuickCrypto: (fn: () => unknown, observe: (value: CryptoLoadDiagnostic) => void) => loadQuickCrypto(fn, observe, fixture.errorUtils) };
      if (name === '../crypto/quickCryptoInstall.ts') return { installQuickCrypto() { installs++; } };
      if (name === '../crypto/native') return {
        createNativeWalletCrypto() { providers++; return {}; },
        qualifyWalletCrypto() { qualifications++; },
        disposeWalletCrypto() {},
      };
      if (name === 'react-native-quick-crypto') { loads++; return load(); }
      throw new Error(`Unexpected fixture import: ${name}`);
    },
  };
  runInNewContext(code, context);
  const first = exported.ensureNativeCryptoReady!() as Promise<unknown>;
  await assert.rejects(first, /NATIVE_CRYPTO_UNAVAILABLE/);
  assert.equal(exported.ensureNativeCryptoReady!(), first);
  assert.equal(exported.nativeCryptoStatus!(), 'unavailable');
  assert.equal(exported.nativeCryptoCheckpoint!(), 'quick-crypto-load');
  assert.equal((exported.nativeCryptoLoadDiagnostic!() as CryptoLoadDiagnostic).markers.quickBase64, true);
  assert.equal(context.crypto, existingCrypto);
  assert.equal(loads, 1);
  assert.equal(providers, 0);
  assert.equal(installs, 0);
  assert.equal(qualifications, 0);
  assert.equal(fixture.errorUtils.getGlobalHandler(), fixture.original);
  assert.equal(fixture.inGuard(), false);
});
