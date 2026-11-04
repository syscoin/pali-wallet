import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL as NodeURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);

test('native bootstrap uses the installed QuickCrypto scheduler without replacing the runtime process', async () => {
  for (const existingScheduler of [undefined, setImmediate]) {
    const environment = { NODE_ENV: 'production' };
    const runtimeProcess = {
      env: environment,
      ...(existingScheduler ? { nextTick: existingScheduler } : {}),
    } as { env: typeof environment; nextTick?: typeof setImmediate };
    const provider = {};
    const exported: Record<string, () => Promise<unknown>> = {};
    const context = createContext({
      process: runtimeProcess, setImmediate, exports: exported,
      require(name: string) {
        if (name === 'expo') return {};
        if (name === '../crypto/quickCryptoLoad.ts')
          return { loadQuickCrypto: (load: () => unknown) => load() };
        if (name === '../crypto/quickCryptoInstall.ts') return { installQuickCrypto() {} };
        if (name === '../crypto/native') return {
          createNativeWalletCrypto: () => provider,
          qualifyWalletCrypto: async () => {},
          disposeWalletCrypto() {},
        };
        if (name === 'react-native-quick-crypto') {
          // Exercise the installed package's real module-level scheduler setup.
          // Native crypto API modules are stubbed here; the native qualification
          // binary, not this host test, verifies their loading and cryptography.
          const entry = nodeRequire.resolve('react-native-quick-crypto');
          const module = { exports: {} };
          const evaluate = runInContext(
            `(function(require, module, exports) { ${readFileSync(entry, 'utf8')}\n})`,
            context,
            { filename: entry }
          );
          evaluate((dependency: string) => {
            if (dependency === '@craftzdog/react-native-buffer') return { Buffer };
            if (dependency === 'react-native-quick-base64' || dependency.startsWith('./')) return {};
            throw Error(`Unexpected QuickCrypto import: ${dependency}`);
          }, module, module.exports);
          return module.exports;
        }
        throw Error(`Unexpected bootstrap import: ${name}`);
      },
    });
    runInContext('globalThis.global = globalThis', context);
    const source = readFileSync(new NodeURL('../src/platform/cryptoBootstrap.native.ts', import.meta.url), 'utf8');
    runInContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, context);

    assert.equal(await exported.ensureNativeCryptoReady!(), provider);
    assert.equal(context.process, runtimeProcess);
    assert.equal(runtimeProcess.env, environment);
    assert.deepEqual(Object.keys(runtimeProcess).sort(), ['env', 'nextTick']);
    assert.equal(runtimeProcess.nextTick, existingScheduler ?? setImmediate);
    const value = await new Promise<string>((resolve) => runtimeProcess.nextTick!(resolve, 'scheduled'));
    assert.equal(value, 'scheduled');
    assert.equal(exported.nativeCryptoStatus!(), 'ready');
  }
});
