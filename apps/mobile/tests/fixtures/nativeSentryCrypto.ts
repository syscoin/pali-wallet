import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createSentryCryptoExecutor } from '../../src/crypto/sentryCryptoExecutor.ts';
import type { RunSentryCrypto } from '../../../../source/wallet/sentryCryptoJobs.ts';

/** Exercise the native wrapper with only bootstrap and module loading substituted. */
export function nativeSentryCryptoFixture(options: {
  ready(): Promise<unknown>;
  isolated(): RunSentryCrypto;
  shared?(): RunSentryCrypto;
}) {
  const module = { exports: {} as typeof import('../../src/crypto/sentryCrypto.native.ts') };
  const source = ts.transpileModule(readFileSync(new URL('../../src/crypto/sentryCrypto.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    module, exports: module.exports,
    require(name: string) {
      switch (name) {
        case '../platform/cryptoBootstrap': return { ensureNativeCryptoReady: options.ready };
        case './sentryCryptoExecutor': return { createSentryCryptoExecutor };
        case '../../modules/pali-private-prover': return { runNativeSentryCrypto: options.isolated() };
        case '../../../../source/wallet/sentryCryptoExecution.ts': {
          assert(options.shared, 'unexpected renderer Sentry load');
          return { executeSentryCryptoJob: options.shared() };
        }
        default: assert.fail(`unexpected native Sentry import ${name}`);
      }
    },
  });
  return module.exports.createNativeSentryCryptoExecutor();
}
