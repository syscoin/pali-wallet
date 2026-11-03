import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import { createWalletCrypto } from '../src/crypto/provider.ts';
import type { NativeCryptoModule } from '../src/crypto/provider.ts';
import { qualifyWalletCrypto } from '../src/crypto/qualification.ts';
import { isCryptoDiagnostic } from '../src/crypto/diagnostics.ts';
import type { CryptoInstallDiagnostic, CryptoLoadDiagnostic } from '../src/crypto/diagnostics.ts';
import { installQuickCrypto } from '../src/crypto/quickCryptoInstall.ts';
import { loadQuickCrypto } from '../src/crypto/quickCryptoLoad.ts';

test('crypto diagnostics accept only public operation labels and no error payload', () => {
  assert(isCryptoDiagnostic({ bootstrap: 'provider-info' }));
  assert(isCryptoDiagnostic({ bootstrap: 'ready', fullCase: 'backup-eight-mib-boundary' }));
  for (const value of [null, {}, [], { bootstrap: 'raw native error' }, { bootstrap: 'ready', error: 'secret' }, { bootstrap: 'ready', fullCase: 'input-dependent label' }])
    assert.equal(isCryptoDiagnostic(value), false);
});

test('provider registration and first primitive failure retain a fixed checkpoint', async () => {
  let checkpoint = '';
  assert.throws(() => createWalletCrypto({ info() { throw Error('sensitive native detail'); } } as unknown as NativeCryptoModule, (step) => { checkpoint = step; }), /NativeCryptoError/);
  assert.equal(checkpoint, 'provider-info');
  const provider = { subtle: { async digest() { throw Error('sensitive native detail'); } } } as unknown as Crypto;
  await assert.rejects(qualifyWalletCrypto(provider, (step) => { checkpoint = step; }));
  assert.equal(checkpoint, 'self-test-sha256');
  assert(!JSON.stringify({ checkpoint }).includes('sensitive'));
});

test('installer diagnostics validate only fixed nested fields and labels', () => {
  const install = { installer: 'callable', error: 'type-error', globals: {
    buffer: 'absent-extensible', crypto: 'data-readonly-configurable',
    base64To: 'accessor-readonly-fixed', base64From: 'inspection-failed',
  } };
  assert(isCryptoDiagnostic({ bootstrap: 'quick-crypto-install', install }));
  for (const invalid of [
    { ...install, message: 'secret' }, { ...install, installer: 'secret' },
    { ...install, error: 'secret' }, { ...install, globals: { ...install.globals, value: 'secret' } },
    { ...install, globals: { ...install.globals, crypto: 'secret' } },
    { ...install, globals: { ...install.globals, buffer: undefined } },
  ]) assert.equal(isCryptoDiagnostic({ bootstrap: 'quick-crypto-install', install: invalid }), false);
});

test('installer observation preserves one property read, invocation receiver and original failures', () => {
  const target = {};
  let reads = 0, calls = 0, reports = 0;
  const module = { get install() {
    reads++;
    return function (this: unknown) { calls++; assert.equal(this, module); };
  } };
  installQuickCrypto(module, () => { reports++; }, target);
  assert.equal(reads, 1);
  assert.equal(calls, 1);
  assert.equal(reports, 0);
  const original = Error('sensitive exception detail');
  let diagnostic: CryptoInstallDiagnostic | undefined;
  assert.throws(() => installQuickCrypto({ install() { throw original; } }, (value) => {
    diagnostic = value; throw Error('observer failed');
  }, target), (error) => error === original);
  assert.equal(diagnostic?.error, 'error');
  assert.equal(diagnostic?.installer, 'callable');
  assert(!JSON.stringify(diagnostic).includes('sensitive'));
});

test('missing, noncallable and unreadable installers are distinguished without inspecting errors', () => {
  const hostile = Object.create(null);
  Object.defineProperty(hostile, 'message', { get() { throw Error('do not read'); } });
  for (const [module, kind, error] of [
    [{}, 'missing', 'type-error'],
    [{ install: { call() { throw Error('must not invoke call property'); } } }, 'noncallable', 'type-error'],
    [{ get install() { throw hostile; } }, 'unreadable', 'other'],
  ] as const) {
    let diagnostic: CryptoInstallDiagnostic | undefined;
    assert.throws(() => installQuickCrypto(module, (value) => { diagnostic = value; }, {}));
    assert.equal(diagnostic?.installer, kind);
    assert.equal(diagnostic?.error, error);
  }
});

test('the actual pinned installer records readonly globals without bypassing its failure', () => {
  const source = readFileSync(new NodeURL('../node_modules/react-native-quick-crypto/src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export const install =');
  const end = source.indexOf('\n};', start) + 3;
  assert(start > 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const target = {};
  let getterCalls = 0;
  Object.defineProperty(target, 'crypto', { value: {}, writable: false, configurable: true });
  Object.defineProperty(target, 'base64ToArrayBuffer', { get() { getterCalls++; throw Error('secret'); }, configurable: true });
  const module: { install?: () => void } = {};
  new Function('global', 'Buffer', 'QuickCrypto', 'toByteArray', 'fromByteArray', 'exports', code)(target, {}, {}, () => undefined, () => undefined, module);
  let diagnostic: CryptoInstallDiagnostic | undefined;
  assert.throws(() => installQuickCrypto(module, (value) => { diagnostic = value; }, target), TypeError);
  assert.equal(diagnostic?.globals.crypto, 'data-readonly-configurable');
  assert.equal(diagnostic?.globals.base64To, 'accessor-readonly-configurable');
  assert.equal(diagnostic?.globals.buffer, 'absent-extensible');
  assert.equal(diagnostic?.error, 'type-error');
  assert.equal(getterCalls, 0);
});

test('load diagnostics retain fixed module markers and reject any additional payload', () => {
  const original = new TypeError('QuickCrypto NitroModules HybridObject QuickBase64 TurboModule synthetic_secret_token_42');
  let diagnostic: CryptoLoadDiagnostic | undefined;
  let handler: (error: unknown, isFatal?: boolean) => void = () => undefined;
  assert.throws(() => loadQuickCrypto(() => { throw original; }, (value) => { diagnostic = value; }, {
    getGlobalHandler: () => handler, setGlobalHandler: (value) => { handler = value; },
  }), (error) => error === original);
  assert.deepEqual(diagnostic, { error: 'type-error', markers: {
    quickCrypto: true, nitroModules: true, nativeHybrid: true, quickBase64: true, turboModule: true,
  } });
  assert(!JSON.stringify(diagnostic).includes('synthetic_secret_token_42'));
  assert(isCryptoDiagnostic({ bootstrap: 'quick-crypto-load', load: diagnostic }));
  for (const load of [
    { ...diagnostic, message: 'secret' }, { ...diagnostic, error: 'secret' },
    { ...diagnostic, markers: { ...diagnostic!.markers, arbitrary: true } },
    { ...diagnostic, markers: { ...diagnostic!.markers, quickCrypto: 'secret' } },
  ]) assert.equal(isCryptoDiagnostic({ bootstrap: 'quick-crypto-load', load }), false);
});

test('load marker inspection is bounded and never invokes exception getters', () => {
  let getterCalls = 0;
  for (const original of [
    Object.defineProperty(new Error(), 'message', { get() { getterCalls++; throw Error('secret'); } }),
    new Error('x'.repeat(4096) + 'QuickCrypto NitroModules'),
  ]) {
    let diagnostic: CryptoLoadDiagnostic | undefined;
    let handler: (error: unknown, isFatal?: boolean) => void = () => undefined;
    assert.throws(() => loadQuickCrypto(() => { throw original; }, (value) => { diagnostic = value; }, {
      getGlobalHandler: () => handler, setGlobalHandler: (value) => { handler = value; },
    }), (error) => error === original);
    assert.deepEqual(diagnostic?.markers, { quickCrypto: false, nitroModules: false, nativeHybrid: false, quickBase64: false, turboModule: false });
  }
  assert.equal(getterCalls, 0);
});
