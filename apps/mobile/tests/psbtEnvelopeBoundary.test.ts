import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('public PSBT request queue loads without custody SDK packages', () => {
  const core = new URL('../../../source/wallet/psbtApprovals.ts', import.meta.url).href;
  const queue = new URL('../src/connections/psbtRequests.ts', import.meta.url).href;
  const envelope = new URL('../../../source/shared/psbtEnvelope.ts', import.meta.url).href;
  // A fresh process prevents another suite's module cache masking an import.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(name, context, next) {
      if (name === 'ethers' || name.startsWith('ethers/') || name.startsWith('@sidhujag/sysweb3') ||
          ['syscoinjs-lib', 'syscointx-js', 'bitcoinjs-lib'].includes(name))
        throw new Error('blocked custody SDK import');
      return next(name, context);
    } });
    await assert.rejects(import(${JSON.stringify(core)}), /blocked custody SDK import/);
    const { capturePsbtEnvelope } = await import(${JSON.stringify(envelope)});
    assert.throws(() => capturePsbtEnvelope(undefined), /Invalid PSBT envelope/);
    await import(${JSON.stringify(queue)});
  `], { stdio: 'pipe', timeout: 10_000 });
});
